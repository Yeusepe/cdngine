/**
 * Purpose: Assembles the local CDNgine public runtime so the public upload workspace can exercise the production upload-session, PATCH upload-target, completion, and public version-read contract against local control-plane state and optional object-store-backed artifact bytes.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://hono.dev/docs
 * - https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
 * - https://nodejs.org/api/http.html
 * - https://nodejs.org/api/stream.html
 * - https://tus.io/protocols/resumable-upload
 * - https://github.com/rustfs/rustfs
 * Tests:
 * - apps/demo/test/demo-api-app.test.mjs
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

import {
	createApiApp,
	InMemoryUploadSessionIssuanceStore,
	PublicAssetVersionNotFoundError,
	PublicDownloadLinkNotFoundError,
	PublicVersionNotReadyError,
	registerDeliveryRoutes,
	registerDownloadLinkRoutes,
	registerUploadSessionRoutes,
} from "../../api/dist/index.js";

const RUNTIME_STATE_SCHEMA_VERSION = 1;

function getOptionalEnvironmentValue(environment, key) {
	const value = environment[key]?.trim();
	return value ? value : undefined;
}

function normalizePrefix(prefix) {
	return prefix?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}

function normalizeObjectKey(objectKey) {
	const normalized = objectKey.trim().replace(/^\/+|\/+$/g, "");
	if (!normalized) {
		throw new Error("Object keys must be non-empty after normalization.");
	}
	return normalized;
}

function resolveQualifiedObjectKey(prefix, objectKey) {
	const normalizedKey = normalizeObjectKey(objectKey);
	const normalizedPrefix = normalizePrefix(prefix);
	return normalizedPrefix ? `${normalizedPrefix}/${normalizedKey}` : normalizedKey;
}

function isMissingObjectError(error) {
	if (!(error instanceof Error)) {
		return false;
	}
	const message = error.message.toLowerCase();
	return (
		error.name === "NotFound" ||
		error.name === "NoSuchKey" ||
		message.includes("not found") ||
		message.includes("no such key")
	);
}

function responseBodyFromObjectBody(body) {
	if (!body) {
		return new Uint8Array();
	}
	if (
		body instanceof Uint8Array ||
		typeof body === "string" ||
		body instanceof ReadableStream
	) {
		return body;
	}
	if (typeof body.transformToWebStream === "function") {
		return body.transformToWebStream();
	}
	if (typeof body.pipe === "function") {
		return Readable.toWeb(body);
	}
	return Buffer.from(body);
}

function encodePersistedValue(value) {
	if (value instanceof Date) {
		return { __cdngineType: "Date", value: value.toISOString() };
	}
	if (typeof value === "bigint") {
		return { __cdngineType: "BigInt", value: value.toString() };
	}
	if (Array.isArray(value)) {
		return value.map((entry) => encodePersistedValue(entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entryValue]) => [
				key,
				encodePersistedValue(entryValue),
			]),
		);
	}
	return value;
}

function decodePersistedValue(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => decodePersistedValue(entry));
	}
	if (value && typeof value === "object") {
		if (value.__cdngineType === "Date" && typeof value.value === "string") {
			return new Date(value.value);
		}
		if (value.__cdngineType === "BigInt" && typeof value.value === "string") {
			return BigInt(value.value);
		}
		return Object.fromEntries(
			Object.entries(value).map(([key, entryValue]) => [
				key,
				decodePersistedValue(entryValue),
			]),
		);
	}
	return value;
}

function mapToPersistedEntries(map) {
	return [...map.entries()].map(([key, value]) => [
		key,
		encodePersistedValue(value),
	]);
}

function restoreMap(target, entries) {
	target.clear();
	for (const [key, value] of entries ?? []) {
		target.set(key, decodePersistedValue(value));
	}
}

function ensureDirectory(directory) {
	mkdirSync(directory, { recursive: true });
}

function hashObjectKey(objectKey) {
	return createHash("sha256").update(objectKey).digest("hex");
}

function readJsonFile(filePath) {
	if (!existsSync(filePath)) {
		return null;
	}
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
	ensureDirectory(path.dirname(filePath));
	writeFileSync(`${filePath}.tmp`, JSON.stringify(value, null, 2));
	rmSync(filePath, { force: true });
	writeFileSync(filePath, readFileSync(`${filePath}.tmp`));
	rmSync(`${filePath}.tmp`, { force: true });
}

class FileBackedUploadSessionIssuanceStore extends InMemoryUploadSessionIssuanceStore {
	constructor(options) {
		super();
		this.stateFilePath = path.join(options.stateDir, "upload-session-store.json");
		this.load();
	}

	async issueUploadSession(input) {
		const result = await super.issueUploadSession(input);
		this.save();
		return result;
	}

	async completeUploadSession(input, canonicalize) {
		try {
			const result = await super.completeUploadSession(input, canonicalize);
			this.save();
			return result;
		} catch (error) {
			this.save();
			throw error;
		}
	}

	load() {
		const persisted = readJsonFile(this.stateFilePath);
		if (!persisted) {
			return;
		}
		if (persisted.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION) {
			throw new Error(
				`Unsupported local runtime upload-session state schema: ${persisted.schemaVersion}`,
			);
		}
		restoreMap(this.assets, persisted.assets);
		restoreMap(this.versionsById, persisted.versionsById);
		restoreMap(this.versionsByAssetId, persisted.versionsByAssetId);
		restoreMap(this.uploadSessions, persisted.uploadSessions);
		restoreMap(this.idempotencyRecords, persisted.idempotencyRecords);
	}

	save() {
		writeJsonFile(this.stateFilePath, {
			schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
			assets: mapToPersistedEntries(this.assets),
			versionsById: mapToPersistedEntries(this.versionsById),
			versionsByAssetId: mapToPersistedEntries(this.versionsByAssetId),
			uploadSessions: mapToPersistedEntries(this.uploadSessions),
			idempotencyRecords: mapToPersistedEntries(this.idempotencyRecords),
		});
	}
}

class LocalRuntimeStagingBlobStore {
	constructor(bucket = "cdngine-ingest", options = {}) {
		this.bucket = bucket;
		this.objects = new Map();
		this.stateDir = options.stateDir;
		this.objectDir = this.stateDir ? path.join(this.stateDir, "objects") : undefined;
		this.manifestPath = this.stateDir
			? path.join(this.stateDir, "staging-objects.json")
			: undefined;
		this.load();
	}

	buildObjectUrl(objectKey) {
		return `/uploads/${objectKey
			.split("/")
			.map((segment) => encodeURIComponent(segment))
			.join("/")}`;
	}

	async createUploadTarget(input) {
		return {
			expiresAt: input.expiresAt,
			method: "PATCH",
			protocol: "tus",
			url: this.buildObjectUrl(input.objectKey),
		};
	}

	async deleteObject(objectKey) {
		this.objects.delete(objectKey);
		if (this.objectDir) {
			rmSync(this.objectPath(objectKey), { force: true });
		}
		this.save();
	}

	async headObject(objectKey) {
		const object = this.objects.get(objectKey);

		if (!object) {
			return null;
		}

		return {
			bucket: this.bucket,
			byteLength: BigInt(object.byteLength ?? object.bytes.length),
			checksum: object.checksum,
			etag: object.checksum.value,
			key: `ingest/${objectKey}`,
		};
	}

	getObject(objectKey) {
		const object = this.objects.get(objectKey);
		if (!object) {
			return null;
		}
		if (!object.bytes && this.objectDir) {
			const objectPath = this.objectPath(objectKey);
			if (!existsSync(objectPath)) {
				return null;
			}
			return {
				...object,
				bytes: readFileSync(objectPath),
			};
		}
		return object;
	}

	async getObjectMetadata(objectKey) {
		const object = this.getObject(objectKey);
		if (!object) {
			return null;
		}
		const byteLength = object.byteLength ?? object.bytes.length;
		return {
			bucket: this.bucket,
			byteLength,
			checksum: object.checksum,
			contentType: object.contentType,
			key: `ingest/${objectKey}`,
		};
	}

	getUploadOffset(objectKey) {
		const object = this.objects.get(objectKey);
		return object?.byteLength ?? object?.bytes?.length ?? 0;
	}

	async writeObject(objectKey, bytes, contentType) {
		const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
		const checksum = {
			algorithm: "sha256",
			value: createHash("sha256").update(buffer).digest("hex"),
		};

		if (this.objectDir) {
			ensureDirectory(this.objectDir);
			writeFileSync(this.objectPath(objectKey), buffer);
		}
		this.objects.set(objectKey, {
			...(this.objectDir ? {} : { bytes: buffer }),
			byteLength: buffer.length,
			checksum,
			contentType,
		});
		this.save();
	}

	load() {
		if (!this.manifestPath) {
			return;
		}
		const persisted = readJsonFile(this.manifestPath);
		if (!persisted) {
			return;
		}
		if (persisted.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION) {
			throw new Error(
				`Unsupported local runtime staging state schema: ${persisted.schemaVersion}`,
			);
		}
		this.objects = new Map(
			(persisted.objects ?? []).map(([objectKey, object]) => [
				objectKey,
				decodePersistedValue(object),
			]),
		);
	}

	objectPath(objectKey) {
		return path.join(this.objectDir, `${hashObjectKey(objectKey)}.blob`);
	}

	save() {
		if (!this.manifestPath) {
			return;
		}
		writeJsonFile(this.manifestPath, {
			schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
			objects: mapToPersistedEntries(this.objects),
		});
	}
}

class BucketBackedLocalRuntimeStagingBlobStore {
	constructor(options) {
		this.bucket = options.bucket;
		this.client = options.client;
		this.prefix = normalizePrefix(options.prefix ?? "uploads");
	}

	buildObjectUrl(objectKey) {
		return `/uploads/${objectKey
			.split("/")
			.map((segment) => encodeURIComponent(segment))
			.join("/")}`;
	}

	async createUploadTarget(input) {
		return {
			expiresAt: input.expiresAt,
			method: "PATCH",
			protocol: "tus",
			url: this.buildObjectUrl(input.objectKey),
		};
	}

	async deleteObject(objectKey) {
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: this.bucket,
				Key: this.resolveObjectKey(objectKey),
			}),
		);
	}

	async getObject(objectKey) {
		try {
			const result = await this.client.send(
				new GetObjectCommand({
					Bucket: this.bucket,
					Key: this.resolveObjectKey(objectKey),
				}),
			);
			return {
				body: responseBodyFromObjectBody(result.Body),
				byteLength: result.ContentLength ?? 0,
				checksum: result.Metadata?.["cdngine-checksum-sha256"]
					? {
							algorithm: "sha256",
							value: result.Metadata["cdngine-checksum-sha256"],
						}
					: undefined,
				contentType: result.ContentType ?? "application/octet-stream",
			};
		} catch (error) {
			if (isMissingObjectError(error)) {
				return null;
			}
			throw error;
		}
	}

	async getObjectMetadata(objectKey) {
		try {
			const result = await this.client.send(
				new HeadObjectCommand({
					Bucket: this.bucket,
					Key: this.resolveObjectKey(objectKey),
				}),
			);
			return {
				bucket: this.bucket,
				byteLength: result.ContentLength ?? 0,
				checksum: result.Metadata?.["cdngine-checksum-sha256"]
					? {
							algorithm: "sha256",
							value: result.Metadata["cdngine-checksum-sha256"],
						}
					: undefined,
				contentType: result.ContentType ?? "application/octet-stream",
				key: this.resolveObjectKey(objectKey),
			};
		} catch (error) {
			if (isMissingObjectError(error)) {
				return null;
			}
			throw error;
		}
	}

	async getUploadOffset(objectKey) {
		const metadata = await this.getObjectMetadata(objectKey);
		return metadata?.byteLength ?? 0;
	}

	async headObject(objectKey) {
		const metadata = await this.getObjectMetadata(objectKey);
		if (!metadata) {
			return null;
		}
		return {
			bucket: metadata.bucket,
			byteLength: BigInt(metadata.byteLength),
			...(metadata.checksum ? { checksum: metadata.checksum } : {}),
			key: metadata.key,
		};
	}

	resolveObjectKey(objectKey) {
		return resolveQualifiedObjectKey(this.prefix, objectKey);
	}

	async writeObject(objectKey, bytes, contentType) {
		const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
		const checksum = createHash("sha256").update(buffer).digest("hex");
		await this.client.send(
			new PutObjectCommand({
				Body: buffer,
				Bucket: this.bucket,
				ContentLength: buffer.length,
				ContentType: contentType,
				Key: this.resolveObjectKey(objectKey),
				Metadata: {
					"cdngine-checksum-sha256": checksum,
				},
			}),
		);
	}
}

class LocalRuntimeSourceRepository {
	async snapshotFromPath(input) {
		return {
			canonicalSourceId: `src_${input.assetVersionId}`,
			digests:
				input.sourceDigests && input.sourceDigests.length > 0
					? input.sourceDigests
					: [{ algorithm: "sha256", value: "missing-runtime-digest" }],
			logicalByteLength: input.logicalByteLength,
			logicalPath: input.localPath,
			repositoryEngine: "xet",
			snapshotId: `snap_${input.assetVersionId}`,
			substrateHints: {
				repositoryTool: "local-runtime",
			},
		};
	}

	async listSnapshots() {
		return [];
	}

	async restoreToPath(input) {
		return {
			restoredPath: input.destinationPath,
		};
	}
}

class UploadSessionPublicReadStore {
	constructor(uploadSessionStore, stagingBlobStore) {
		this.uploadSessionStore = uploadSessionStore;
		this.stagingBlobStore = stagingBlobStore;
	}

	async authorizeDelivery(
		assetId,
		versionId,
		deliveryScopeId,
		variant,
		request,
	) {
		const version = this.getRequiredVersion(assetId, versionId);

		if (version.lifecycleState !== "published") {
			throw new PublicVersionNotReadyError(
				assetId,
				versionId,
				version.lifecycleState,
			);
		}

		return {
			assetId,
			authorizationMode: "signed-url",
			deliveryScopeId,
			expiresAt: new Date(request.now.getTime() + 15 * 60_000),
			resolvedOrigin: "cdn-derived",
			url: this.stagingBlobStore.buildObjectUrl(
				this.getPersistedVersion(assetId, versionId).objectKey,
			),
			versionId,
		};
	}

	async authorizeSource(assetId, versionId, _preferredDisposition, request) {
		const version = this.getRequiredVersion(assetId, versionId);
		const persistedVersion = this.getPersistedVersion(assetId, versionId);

		if (
			version.lifecycleState === "quarantined" ||
			version.lifecycleState === "purged"
		) {
			throw new PublicVersionNotReadyError(
				assetId,
				versionId,
				version.lifecycleState,
			);
		}

		return {
			assetId,
			authorizationMode: "signed-url",
			expiresAt: new Date(request.now.getTime() + 15 * 60_000),
			resolvedOrigin: "source-export",
			...(version.tenantId ? { tenantId: version.tenantId } : {}),
			url: this.stagingBlobStore.buildObjectUrl(persistedVersion.objectKey),
			versionId,
		};
	}

	async consumeDownloadLink(token) {
		throw new PublicDownloadLinkNotFoundError(token);
	}

	async getManifest(assetId, versionId, manifestType) {
		const version = this.getRequiredVersion(assetId, versionId);

		if (version.lifecycleState !== "published") {
			throw new PublicVersionNotReadyError(
				assetId,
				versionId,
				version.lifecycleState,
			);
		}

		return {
			assetId,
			deliveryScopeId: "public-default",
			manifestPayload: {
				assetId,
				derivatives: [],
				manifestType,
				versionId,
			},
			manifestType,
			objectKey: `manifests/${assetId}/${versionId}/${manifestType}`,
			versionId,
		};
	}

	async getVersion(assetId, versionId) {
		const persistedVersion =
			this.uploadSessionStore.getPersistedVersion(versionId);

		if (
			!persistedVersion ||
			persistedVersion.assetId !== assetId ||
			!persistedVersion.canonicalSourceEvidence
		) {
			return null;
		}

		return {
			assetId: persistedVersion.assetId,
			assetOwner: persistedVersion.assetOwner,
			canonicalSourceEvidence: persistedVersion.canonicalSourceEvidence,
			lifecycleState: this.mapLifecycleState(persistedVersion.lifecycleState),
			serviceNamespaceId: persistedVersion.serviceNamespaceId,
			source: {
				byteLength: persistedVersion.byteLength,
				contentType: persistedVersion.contentType,
				filename: persistedVersion.filename,
			},
			...(persistedVersion.tenantId
				? { tenantId: persistedVersion.tenantId }
				: {}),
			versionId: persistedVersion.versionId,
			versionNumber: persistedVersion.versionNumber,
			workflowState: persistedVersion.workflowDispatch?.state ?? "pending",
		};
	}

	async listDerivatives(assetId, versionId) {
		const version = this.getRequiredVersion(assetId, versionId);

		if (version.lifecycleState !== "published") {
			throw new PublicVersionNotReadyError(
				assetId,
				versionId,
				version.lifecycleState,
			);
		}

		return [];
	}

	getPersistedVersion(assetId, versionId) {
		const persistedVersion =
			this.uploadSessionStore.getPersistedVersion(versionId);

		if (
			!persistedVersion ||
			persistedVersion.assetId !== assetId ||
			!persistedVersion.canonicalSourceEvidence
		) {
			throw new PublicAssetVersionNotFoundError(assetId, versionId);
		}

		return persistedVersion;
	}

	getRequiredVersion(assetId, versionId) {
		const version = this.uploadSessionStore.getPersistedVersion(versionId);

		if (
			!version ||
			version.assetId !== assetId ||
			!version.canonicalSourceEvidence
		) {
			throw new PublicAssetVersionNotFoundError(assetId, versionId);
		}

		return {
			...(version.tenantId ? { tenantId: version.tenantId } : {}),
			lifecycleState: this.mapLifecycleState(version.lifecycleState),
		};
	}

	mapLifecycleState(versionLifecycleState) {
		switch (versionLifecycleState) {
			case "canonical":
				return "canonical";
			case "published":
				return "published";
			case "processing":
				return "processing";
			case "quarantined":
				return "quarantined";
			case "failed_retryable":
			case "failed_validation":
				return "failed_retryable";
			case "session_created":
			case "uploaded":
			case "canonicalizing":
			default:
				return "processing";
		}
	}
}

const localRuntimeAuth = {
	async authenticateHeaders() {
		return {
			allowedServiceNamespaces: [],
			allowedTenantIds: [],
			roles: [],
			subject: "local-public-runtime-actor",
		};
	},
};

function getUploadObjectKey(pathname) {
	return decodeURIComponent(pathname.replace(/^\/uploads\//u, ""));
}

function createNodeRequestHandler(app, fallbackOrigin) {
	return async (req, res) => {
		const chunks = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const body = Buffer.concat(chunks);

		const headers = new Headers();
		for (const [key, value] of Object.entries(req.headers)) {
			if (Array.isArray(value)) {
				for (const headerValue of value) {
					headers.append(key, headerValue);
				}
			} else if (value) {
				headers.set(key, value);
			}
		}

		const method = (req.method ?? "GET").toUpperCase();
		const request = new Request(new URL(req.url ?? "/", fallbackOrigin), {
			body:
				!["GET", "HEAD", "OPTIONS"].includes(method) && body.length > 0
					? body
					: undefined,
			headers,
			method,
		});

		let response;
		try {
			response = await app.fetch(request);
		} catch (error) {
			console.error("Public runtime error:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Internal server error" }));
			return;
		}

		const responseHeaders = {};
		for (const [key, value] of response.headers.entries()) {
			responseHeaders[key] = value;
		}
		res.writeHead(response.status, responseHeaders);

		if (method === "HEAD" || !response.body) {
			res.end();
			return;
		}

		await pipeline(Readable.fromWeb(response.body), res);
	};
}

function createTusErrorResponse(detail, status) {
	return Response.json(
		{ detail, error: "Upload target request rejected." },
		{ headers: createUploadTargetCorsHeaders(), status },
	);
}

function createUploadTargetCorsHeaders(origin = "*") {
	return {
		"Access-Control-Allow-Headers":
			"Content-Type,Tus-Resumable,Upload-Offset,Upload-Length",
		"Access-Control-Allow-Methods": "HEAD,GET,PATCH,OPTIONS",
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Expose-Headers":
			"Tus-Resumable,Upload-Length,Upload-Offset",
		Vary: "Origin",
	};
}

export function createPublicRuntimeApp(options = {}) {
	const stateDir = options.stateDir;
	if (stateDir) {
		ensureDirectory(stateDir);
	}
	const uploadSessionStore = stateDir
		? new FileBackedUploadSessionIssuanceStore({ stateDir })
		: new InMemoryUploadSessionIssuanceStore();
	const stagingBlobStore = options.objectStore
		? new BucketBackedLocalRuntimeStagingBlobStore(options.objectStore)
		: new LocalRuntimeStagingBlobStore("cdngine-ingest", {
				stateDir,
			});
	const sourceRepository = new LocalRuntimeSourceRepository();
	const publicReadStore = new UploadSessionPublicReadStore(
		uploadSessionStore,
		stagingBlobStore,
	);

	return createApiApp({
		auth: localRuntimeAuth,
		requestTimeoutMs: 60_000,
		registerCapabilityRoutes(app) {
			app.options("/uploads/*", async (context) => {
				return new Response(null, {
					headers: createUploadTargetCorsHeaders(
						context.req.header("origin") ?? "*",
					),
					status: 204,
				});
			});

			app.on("HEAD", "/uploads/*", async (context) => {
				const objectKey = getUploadObjectKey(context.req.path);
				const object = await stagingBlobStore.getObjectMetadata(objectKey);

				if (!object) {
					return new Response(null, {
						headers: createUploadTargetCorsHeaders(
							context.req.header("origin") ?? "*",
						),
						status: 404,
					});
				}

				return new Response(null, {
					headers: {
						...createUploadTargetCorsHeaders(
							context.req.header("origin") ?? "*",
						),
						"Cache-Control": "no-store",
						"Content-Length": String(object.byteLength),
						"Content-Type": object.contentType,
						"Tus-Resumable": "1.0.0",
						"Upload-Length": String(object.byteLength),
						"Upload-Offset": String(await stagingBlobStore.getUploadOffset(objectKey)),
					},
					status: 204,
				});
			});

			app.patch("/uploads/*", async (context) => {
				const tusResumable = context.req.header("tus-resumable");
				const uploadOffset = context.req.header("upload-offset");

				if (tusResumable !== "1.0.0") {
					return createTusErrorResponse(
						"Tus-Resumable: 1.0.0 is required.",
						412,
					);
				}

				if (uploadOffset !== "0") {
					return createTusErrorResponse(
						"This local runtime accepts upload patches that start at Upload-Offset: 0.",
						409,
					);
				}

				const objectKey = getUploadObjectKey(context.req.path);
				const body = new Uint8Array(await context.req.arrayBuffer());
				await stagingBlobStore.writeObject(
					objectKey,
					body,
					context.req.header("content-type") ??
						"application/offset+octet-stream",
				);

				return new Response(null, {
					headers: {
						...createUploadTargetCorsHeaders(
							context.req.header("origin") ?? "*",
						),
						"Tus-Resumable": "1.0.0",
						"Upload-Offset": String(body.byteLength),
					},
					status: 204,
				});
			});

			app.get("/uploads/*", async (context) => {
				const objectKey = getUploadObjectKey(context.req.path);
				const object = await stagingBlobStore.getObject(objectKey);
				const isHeadRequest =
					context.req.method === "HEAD" ||
					context.req.raw.method?.toUpperCase() === "HEAD";

				if (!object) {
					return context.json(
						{ error: "File not found." },
						404,
						createUploadTargetCorsHeaders(context.req.header("origin") ?? "*"),
					);
				}

				return new Response(
					isHeadRequest ? null : (object.bytes ?? object.body),
					{
					headers: {
						...createUploadTargetCorsHeaders(
							context.req.header("origin") ?? "*",
						),
						"Cache-Control": "no-store",
						"Content-Disposition": `attachment; filename="${objectKey.split("/").pop() ?? "download"}"`,
						"Content-Length": String(object.byteLength ?? object.bytes.length),
						"Content-Type": object.contentType,
						"Tus-Resumable": "1.0.0",
						"Upload-Length": String(object.byteLength ?? object.bytes.length),
						"Upload-Offset": String(await stagingBlobStore.getUploadOffset(objectKey)),
					},
					status: isHeadRequest ? 204 : 200,
					},
				);
			});
		},
		registerPublicRoutes(publicApp) {
			registerUploadSessionRoutes(publicApp, {
				sourceRepository,
				stagingBlobStore,
				store: uploadSessionStore,
			});
			registerDeliveryRoutes(publicApp, { store: publicReadStore });
			registerDownloadLinkRoutes(publicApp, { store: publicReadStore });
		},
	});
}

export function resolvePublicRuntimeObjectStoreFromEnvironment(
	environment = process.env,
) {
	const mode = getOptionalEnvironmentValue(
		environment,
		"CDNGINE_PUBLIC_RUNTIME_STORAGE",
	);
	if (mode === "local-files") {
		return null;
	}
	if (mode && mode !== "object-store" && mode !== "auto") {
		throw new Error(
			`CDNGINE_PUBLIC_RUNTIME_STORAGE must be "object-store", "local-files", or "auto". Received "${mode}".`,
		);
	}

	const endpoint =
		getOptionalEnvironmentValue(environment, "CDNGINE_S3_ENDPOINT") ??
		getOptionalEnvironmentValue(environment, "RUSTFS_ENDPOINT");
	const bucket =
		getOptionalEnvironmentValue(environment, "CDNGINE_INGEST_BUCKET") ??
		getOptionalEnvironmentValue(environment, "CDNGINE_STORAGE_BUCKET") ??
		getOptionalEnvironmentValue(environment, "STAGING_BUCKET");

	if (!endpoint || !bucket) {
		if (mode === "object-store") {
			throw new Error(
				"Object-store public runtime requires CDNGINE_S3_ENDPOINT or RUSTFS_ENDPOINT, plus CDNGINE_INGEST_BUCKET, CDNGINE_STORAGE_BUCKET, or STAGING_BUCKET.",
			);
		}
		return null;
	}

	const accessKeyId =
		getOptionalEnvironmentValue(environment, "AWS_ACCESS_KEY_ID") ??
		getOptionalEnvironmentValue(environment, "RUSTFS_ACCESS_KEY");
	const secretAccessKey =
		getOptionalEnvironmentValue(environment, "AWS_SECRET_ACCESS_KEY") ??
		getOptionalEnvironmentValue(environment, "RUSTFS_SECRET_KEY");
	const credentials =
		accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
	const forcePathStyle =
		(getOptionalEnvironmentValue(environment, "CDNGINE_S3_FORCE_PATH_STYLE") ??
			"true") !== "false";

	return {
		bucket,
		client: new S3Client({
			...(credentials ? { credentials } : {}),
			endpoint,
			forcePathStyle,
			region:
				getOptionalEnvironmentValue(environment, "AWS_REGION") ?? "us-east-1",
		}),
		prefix:
			normalizePrefix(
				getOptionalEnvironmentValue(environment, "CDNGINE_INGEST_PREFIX") ??
					getOptionalEnvironmentValue(environment, "TUSD_OBJECT_PREFIX") ??
					"uploads",
			),
	};
}

export function createPublicRuntimeServer(options = {}) {
	const fallbackOrigin =
		options.publicBaseUrl ??
		`http://${options.host ?? "127.0.0.1"}:${options.port ?? 4000}`;
	const app = createPublicRuntimeApp({
		objectStore: options.objectStore,
		stateDir: options.stateDir,
	});

	return {
		app,
		server: http.createServer(createNodeRequestHandler(app, fallbackOrigin)),
	};
}
