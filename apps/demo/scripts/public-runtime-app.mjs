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
import { createStaticServiceAccountAuthenticatorFromEnvironment } from "@cdngine/auth";
import {
	RuntimeReadinessMonitor,
	loadReadinessProfileFromEnvironment,
} from "@cdngine/observability";
import { runGenericAssetPublicationWorkflow } from "@cdngine/workflows";

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
const LOCAL_RUNTIME_DEFAULT_DELIVERY_SCOPE_ID = "paid-downloads";
const LOCAL_RUNTIME_GENERIC_MANIFEST_TYPE = "generic-asset-default";

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

async function bytesFromBody(body) {
	if (!body) {
		return Buffer.alloc(0);
	}
	if (Buffer.isBuffer(body)) {
		return body;
	}
	if (body instanceof Uint8Array) {
		return Buffer.from(body);
	}
	if (typeof body === "string") {
		return Buffer.from(body);
	}
	if (body instanceof ReadableStream) {
		return Buffer.from(await new Response(body).arrayBuffer());
	}
	if (typeof body.transformToByteArray === "function") {
		return Buffer.from(await body.transformToByteArray());
	}
	if (typeof body.transformToWebStream === "function") {
		return Buffer.from(await new Response(body.transformToWebStream()).arrayBuffer());
	}
	if (typeof body[Symbol.asyncIterator] === "function") {
		const chunks = [];
		for await (const chunk of body) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		return Buffer.concat(chunks);
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

class LocalRuntimeUploadSessionStore extends InMemoryUploadSessionIssuanceStore {
	constructor(options = {}) {
		super(options);
		this.afterCompleteUploadSession = undefined;
		this.publishedDerivativesByKey = new Map();
		this.publishedManifestsByKey = new Map();
	}

	setAfterCompleteUploadSession(callback) {
		this.afterCompleteUploadSession = callback;
	}

	async completeUploadSession(input, canonicalize) {
		try {
			const result = await super.completeUploadSession(input, canonicalize);
			await this.afterCompleteUploadSession?.(result);
			this.save();
			return result;
		} catch (error) {
			this.save();
			throw error;
		}
	}

	async beginGenericAssetPublication(input) {
		const version = this.getMutablePublicationVersion(input.versionId);

		if (
			version.lifecycleState !== "canonical" &&
			version.lifecycleState !== "processing" &&
			version.lifecycleState !== "published"
		) {
			throw new Error(
				`Generic asset version "${input.versionId}" cannot begin processing from lifecycle state "${version.lifecycleState}".`,
			);
		}

		version.lifecycleState = "processing";
		this.save();

		return this.toGenericAssetVersionRecord(version);
	}

	async getVersion(versionId) {
		const version = this.versionsById.get(versionId);

		return version?.canonicalSourceEvidence
			? this.toGenericAssetVersionRecord(version)
			: null;
	}

	async listPublishedDerivatives(versionId) {
		return [...this.publishedDerivativesByKey.values()]
			.filter((derivative) => derivative.assetVersionId === versionId)
			.sort((left, right) =>
				left.deterministicKey.localeCompare(right.deterministicKey),
			)
			.map((derivative) => ({
				...derivative,
				publishedAt: new Date(derivative.publishedAt),
			}));
	}

	async publishGenericAssetVersion(input) {
		const version = this.getMutablePublicationVersion(input.versionId);

		if (
			version.lifecycleState !== "processing" &&
			version.lifecycleState !== "published"
		) {
			throw new Error(
				`Generic asset version "${input.versionId}" cannot publish derivatives from lifecycle state "${version.lifecycleState}".`,
			);
		}

		for (const derivative of input.derivatives) {
			this.publishedDerivativesByKey.set(
				this.buildDerivativeKey(derivative),
				{
					...derivative,
					publishedAt: new Date(derivative.publishedAt),
				},
			);
		}

		this.publishedManifestsByKey.set(
			this.buildManifestKey({
				deliveryScopeId: input.deliveryScopeId,
				manifestType: input.manifest.manifestType,
				versionId: input.versionId,
			}),
			{
				...input.manifest,
				publishedAt: new Date(input.manifest.publishedAt),
			},
		);
		version.lifecycleState = "published";
		if (version.workflowDispatch) {
			version.workflowDispatch = {
				...version.workflowDispatch,
				state: "completed",
			};
		}
		this.save();

		return this.toGenericAssetVersionRecord(version);
	}

	async readManifest(versionId, manifestType, deliveryScopeId) {
		const manifest = this.publishedManifestsByKey.get(
			this.buildManifestKey({ deliveryScopeId, manifestType, versionId }),
		);

		return manifest
			? {
					...manifest,
					publishedAt: new Date(manifest.publishedAt),
				}
			: null;
	}

	findPublishedDerivative(versionId, deliveryScopeId, variant) {
		return [...this.publishedDerivativesByKey.values()].find(
			(derivative) =>
				derivative.assetVersionId === versionId &&
				derivative.deliveryScopeId === deliveryScopeId &&
				derivative.variantKey === variant,
		);
	}

	findPublishedManifest(versionId, manifestType) {
		return [...this.publishedManifestsByKey.values()].find(
			(manifest) =>
				manifest.assetVersionId === versionId &&
				manifest.manifestType === manifestType,
		);
	}

	getDefaultManifestType(versionId) {
		return [...this.publishedManifestsByKey.values()].find(
			(manifest) => manifest.assetVersionId === versionId,
		)?.manifestType;
	}

	listPendingGenericAssetPublicationDispatches() {
		return [...this.versionsById.values()]
			.filter(
				(version) =>
					version.canonicalSourceEvidence &&
					(version.lifecycleState === "canonical" ||
						version.lifecycleState === "processing") &&
					version.workflowDispatch?.workflowKey.endsWith(
						":asset-derivation-v1",
					),
			)
			.map((version) => ({
				versionId: version.versionId,
				workflowDispatch: { ...version.workflowDispatch },
			}));
	}

	getMutablePublicationVersion(versionId) {
		const version = this.versionsById.get(versionId);

		if (!version?.canonicalSourceEvidence) {
			throw new Error(`Generic asset version "${versionId}" does not exist.`);
		}

		return version;
	}

	toGenericAssetVersionRecord(version) {
		if (!version.canonicalSourceEvidence) {
			throw new Error(
				`Generic asset version "${version.versionId}" is missing canonical source evidence.`,
			);
		}

		return {
			assetId: version.assetId,
			canonicalSourceEvidence: {
				...version.canonicalSourceEvidence,
				canonicalDigestSet:
					version.canonicalSourceEvidence.canonicalDigestSet.map((digest) => ({
						...digest,
					})),
				...(version.canonicalSourceEvidence.dedupeMetrics
					? {
							dedupeMetrics: {
								...version.canonicalSourceEvidence.dedupeMetrics,
							},
						}
					: {}),
				...(version.canonicalSourceEvidence.sourceReconstructionHandles
					? {
							sourceReconstructionHandles:
								version.canonicalSourceEvidence.sourceReconstructionHandles.map(
									(handle) => ({ ...handle }),
								),
						}
					: {}),
				...(version.canonicalSourceEvidence.sourceSubstrateHints
					? {
							sourceSubstrateHints: {
								...version.canonicalSourceEvidence.sourceSubstrateHints,
							},
						}
					: {}),
			},
			detectedContentType: version.contentType,
			lifecycleState:
				version.lifecycleState === "published"
					? "published"
					: version.lifecycleState === "processing"
						? "processing"
						: "canonical",
			serviceNamespaceId: version.serviceNamespaceId,
			sourceByteLength: BigInt(version.byteLength),
			sourceChecksumValue: version.checksum.value,
			sourceFilename: version.filename,
			versionId: version.versionId,
			versionNumber: version.versionNumber,
		};
	}

	buildDerivativeKey(derivative) {
		return [
			derivative.assetVersionId,
			derivative.deliveryScopeId,
			derivative.recipeId,
			derivative.schemaVersion,
			derivative.variantKey,
		].join(":");
	}

	buildManifestKey(input) {
		return [
			input.versionId,
			input.deliveryScopeId,
			input.manifestType,
		].join(":");
	}

	save() {}
}

class FileBackedUploadSessionIssuanceStore extends LocalRuntimeUploadSessionStore {
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
		restoreMap(this.publishedDerivativesByKey, persisted.publishedDerivatives);
		restoreMap(this.publishedManifestsByKey, persisted.publishedManifests);
	}

	save() {
		writeJsonFile(this.stateFilePath, {
			schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
			assets: mapToPersistedEntries(this.assets),
			versionsById: mapToPersistedEntries(this.versionsById),
			versionsByAssetId: mapToPersistedEntries(this.versionsByAssetId),
			uploadSessions: mapToPersistedEntries(this.uploadSessions),
			idempotencyRecords: mapToPersistedEntries(this.idempotencyRecords),
			publishedDerivatives: mapToPersistedEntries(this.publishedDerivativesByKey),
			publishedManifests: mapToPersistedEntries(this.publishedManifestsByKey),
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

class LocalRuntimeDerivedObjectStore {
	constructor(stagingBlobStore) {
		this.stagingBlobStore = stagingBlobStore;
	}

	async publishObject(input) {
		const bytes = await bytesFromBody(input.body);
		await this.stagingBlobStore.writeObject(
			input.objectKey,
			bytes,
			input.contentType,
		);

		return {
			bucket: "cdngine-local-derived",
			etag: input.checksum?.value,
			key: input.objectKey,
		};
	}

	async headObject(objectKey) {
		const metadata = await this.stagingBlobStore.getObjectMetadata(objectKey);

		return metadata
			? {
					bucket: metadata.bucket,
					byteLength: BigInt(metadata.byteLength),
					...(metadata.checksum ? { checksum: metadata.checksum } : {}),
					key: objectKey,
				}
			: null;
	}

	async issueSignedReadUrl(objectKey, expiresAt) {
		return {
			expiresAt,
			url: this.stagingBlobStore.buildObjectUrl(objectKey),
		};
	}
}

class LocalRuntimeGenericAssetProcessor {
	constructor(uploadSessionStore, stagingBlobStore) {
		this.uploadSessionStore = uploadSessionStore;
		this.stagingBlobStore = stagingBlobStore;
	}

	async processAssetDerivative(input) {
		const version = this.uploadSessionStore.getPersistedVersion(input.versionId);
		if (!version?.canonicalSourceEvidence) {
			throw new Error(
				`Generic asset version "${input.versionId}" is missing canonical source evidence.`,
			);
		}

		const sourceObject = await this.stagingBlobStore.getObject(version.objectKey);
		if (!sourceObject) {
			throw new Error(
				`Generic asset version "${input.versionId}" cannot restore staged source object "${version.objectKey}".`,
			);
		}

		const bytes = await bytesFromBody(sourceObject.bytes ?? sourceObject.body);
		const checksum =
			version.canonicalSourceEvidence.canonicalDigestSet.find(
				(digest) => digest.algorithm === "sha256",
			) ?? sourceObject.checksum;

		return {
			body: bytes,
			byteLength: BigInt(sourceObject.byteLength ?? bytes.byteLength),
			...(checksum ? { checksum } : {}),
			contentType: version.contentType,
		};
	}
}

class LocalRuntimePublicationRuntime {
	constructor(uploadSessionStore, stagingBlobStore) {
		this.uploadSessionStore = uploadSessionStore;
		this.derivedObjectStore = new LocalRuntimeDerivedObjectStore(stagingBlobStore);
		this.processorActivity = new LocalRuntimeGenericAssetProcessor(
			uploadSessionStore,
			stagingBlobStore,
		);
	}

	async publishCompletedUpload(completed) {
		await this.publishWorkflowDispatch({
			versionId: completed.versionId,
			workflowDispatch: completed.workflowDispatch,
		});
	}

	async publishPendingUploads() {
		for (const pending of this.uploadSessionStore.listPendingGenericAssetPublicationDispatches()) {
			await this.publishWorkflowDispatch(pending);
		}
	}

	async publishWorkflowDispatch(input) {
		if (input.workflowDispatch?.state === "completed") {
			return;
		}
		if (
			!input.workflowDispatch?.workflowKey.endsWith(":asset-derivation-v1")
		) {
			return;
		}

		await runGenericAssetPublicationWorkflow(
			{
				deliveryScopeId: LOCAL_RUNTIME_DEFAULT_DELIVERY_SCOPE_ID,
				versionId: input.versionId,
				workflowId: input.workflowDispatch.dispatchId,
			},
			{
				derivedObjectStore: this.derivedObjectStore,
				now: () => new Date(),
				processorActivity: this.processorActivity,
				publicationStore: this.uploadSessionStore,
			},
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
	constructor(uploadSessionStore, stagingBlobStore, publicationReplay) {
		this.uploadSessionStore = uploadSessionStore;
		this.stagingBlobStore = stagingBlobStore;
		this.publicationReplay = publicationReplay;
	}

	async authorizeDelivery(
		assetId,
		versionId,
		deliveryScopeId,
		variant,
		request,
	) {
		await this.awaitPublicationReplay();
		const version = this.getRequiredVersion(assetId, versionId);

		if (version.lifecycleState !== "published") {
			throw new PublicVersionNotReadyError(
				assetId,
				versionId,
				version.lifecycleState,
			);
		}
		const derivative = this.uploadSessionStore.findPublishedDerivative(
			versionId,
			deliveryScopeId,
			variant,
		);
		if (!derivative) {
			throw new PublicAssetVersionNotFoundError(assetId, versionId);
		}

		return {
			assetId,
			authorizationMode: "signed-url",
			deliveryScopeId,
			expiresAt: new Date(request.now.getTime() + 15 * 60_000),
			resolvedOrigin: "cdn-derived",
			url: this.stagingBlobStore.buildObjectUrl(derivative.deterministicKey),
			versionId,
		};
	}

	async authorizeSource(assetId, versionId, _preferredDisposition, request) {
		await this.awaitPublicationReplay();
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
		await this.awaitPublicationReplay();
		const version = this.getRequiredVersion(assetId, versionId);

		if (version.lifecycleState !== "published") {
			throw new PublicVersionNotReadyError(
				assetId,
				versionId,
				version.lifecycleState,
			);
		}

		const manifest = this.uploadSessionStore.findPublishedManifest(
			versionId,
			manifestType,
		);

		return manifest
			? {
					assetId,
					deliveryScopeId: manifest.deliveryScopeId,
					manifestPayload: manifest.manifestPayload,
					manifestType: manifest.manifestType,
					objectKey: manifest.objectKey,
					versionId,
				}
			: null;
	}

	async getVersion(assetId, versionId) {
		await this.awaitPublicationReplay();
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
			defaultManifestType:
				this.uploadSessionStore.getDefaultManifestType(persistedVersion.versionId) ??
				LOCAL_RUNTIME_GENERIC_MANIFEST_TYPE,
			...(persistedVersion.tenantId
				? { tenantId: persistedVersion.tenantId }
				: {}),
			versionId: persistedVersion.versionId,
			versionNumber: persistedVersion.versionNumber,
			workflowState:
				persistedVersion.lifecycleState === "published"
					? "completed"
					: (persistedVersion.workflowDispatch?.state ?? "pending"),
		};
	}

	async listDerivatives(assetId, versionId) {
		await this.awaitPublicationReplay();
		const version = this.getRequiredVersion(assetId, versionId);

		if (version.lifecycleState !== "published") {
			throw new PublicVersionNotReadyError(
				assetId,
				versionId,
				version.lifecycleState,
			);
		}

		return (await this.uploadSessionStore.listPublishedDerivatives(versionId)).map(
			(derivative) => ({
				byteLength: derivative.byteLength,
				contentType: derivative.contentType,
				derivativeId: derivative.deterministicKey,
				deterministicKey: derivative.deterministicKey,
				recipeId: derivative.recipeId,
				variant: derivative.variantKey,
			}),
		);
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

	async awaitPublicationReplay() {
		if (this.publicationReplay) {
			await this.publicationReplay;
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

function hasServiceAccountTokenConfiguration(environment) {
	return Boolean(
		getOptionalEnvironmentValue(environment, "CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON"),
	);
}

function isProductionLikePublicRuntimeEnvironment(environment) {
	return (
		getOptionalEnvironmentValue(environment, "NODE_ENV") === "production" ||
		getOptionalEnvironmentValue(environment, "CDNGINE_DEPLOYMENT_PROFILE") ===
			"production-default"
	);
}

export function resolvePublicRuntimeAuthModeFromEnvironment(
	environment = process.env,
) {
	const explicitMode =
		getOptionalEnvironmentValue(environment, "CDNGINE_PUBLIC_RUNTIME_AUTH_MODE") ??
		"auto";

	if (!["auto", "local", "service-accounts"].includes(explicitMode)) {
		throw new Error(
			`CDNGINE_PUBLIC_RUNTIME_AUTH_MODE must be "auto", "local", or "service-accounts". Received "${explicitMode}".`,
		);
	}

	if (
		explicitMode === "local" &&
		isProductionLikePublicRuntimeEnvironment(environment)
	) {
		throw new Error(
			"CDNGINE_PUBLIC_RUNTIME_AUTH_MODE=local is not allowed for production-like public runtime deployments.",
		);
	}

	if (explicitMode === "service-accounts") {
		return "service-accounts";
	}

	if (explicitMode === "local") {
		return "local";
	}

	if (hasServiceAccountTokenConfiguration(environment)) {
		return "service-accounts";
	}

	if (isProductionLikePublicRuntimeEnvironment(environment)) {
		throw new Error(
			"CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON is required for production-like public runtime deployments.",
		);
	}

	return "local";
}

export function resolvePublicRuntimeAuthFromEnvironment(
	environment = process.env,
) {
	const authMode = resolvePublicRuntimeAuthModeFromEnvironment(environment);

	if (authMode === "service-accounts") {
		return createStaticServiceAccountAuthenticatorFromEnvironment(environment);
	}

	return localRuntimeAuth;
}

export function createPublicRuntimeReadinessMonitor(options = {}) {
	const environment = options.environment ?? process.env;
	const readinessProfile = loadReadinessProfileFromEnvironment(environment);
	const authMode = options.authMode ?? resolvePublicRuntimeAuthModeFromEnvironment(environment);
	const storageMode =
		options.storageMode ??
		(options.objectStore
			? "object-store"
			: getOptionalEnvironmentValue(
					environment,
					"CDNGINE_PUBLIC_RUNTIME_STORAGE",
				) ?? "local-files");
	const storageDetail =
		storageMode === "object-store"
			? "object-store staging backend"
			: "local file staging backend";

	return new RuntimeReadinessMonitor({
		checks: {
			auth: () => ({
				detail:
					authMode === "service-accounts"
						? "Service-account bearer authentication is configured."
						: "Local public runtime authentication is active.",
				status: "ok",
			}),
			"derived-store": () => ({
				detail: `Derived artifact publication uses the ${storageDetail}.`,
				status: "ok",
			}),
			"exports-store": () => ({
				detail: `Source export reads use the ${storageDetail}.`,
				status: "ok",
			}),
			"source-repository": () => ({
				detail: "Local runtime source repository adapter is initialized.",
				status: "ok",
			}),
		},
		deploymentProfile: readinessProfile.deploymentProfile,
		requiredDependencies: readinessProfile.requiredDependencies,
		timeoutMs: options.timeoutMs,
	});
}

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
		: new LocalRuntimeUploadSessionStore();
	const stagingBlobStore = options.objectStore
		? new BucketBackedLocalRuntimeStagingBlobStore(options.objectStore)
		: new LocalRuntimeStagingBlobStore("cdngine-ingest", {
				stateDir,
			});
	const publicationRuntime = new LocalRuntimePublicationRuntime(
		uploadSessionStore,
		stagingBlobStore,
	);
	uploadSessionStore.setAfterCompleteUploadSession((completed) =>
		publicationRuntime.publishCompletedUpload(completed),
	);
	const publicationReplay = publicationRuntime.publishPendingUploads();
	const sourceRepository = new LocalRuntimeSourceRepository();
	const publicReadStore = new UploadSessionPublicReadStore(
		uploadSessionStore,
		stagingBlobStore,
		publicationReplay,
	);
	const auth = options.auth ?? localRuntimeAuth;

	return createApiApp({
		auth,
		readiness: options.readiness,
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

export function resolvePublicRuntimePortFromEnvironment(
	environment = process.env,
	fallback = 4000,
) {
	for (const key of ["PORT", "WEB_PORT", "CDNGINE_PUBLIC_RUNTIME_PORT"]) {
		const value = getOptionalEnvironmentValue(environment, key);
		if (!value) {
			continue;
		}
		if (value.startsWith("${") && value.endsWith("}")) {
			continue;
		}

		const port = Number(value);
		if (Number.isInteger(port) && port > 0) {
			return port;
		}

		throw new Error(`${key} must be a positive integer. Received "${value}".`);
	}

	return fallback;
}

export function createPublicRuntimeServer(options = {}) {
	const fallbackOrigin =
		options.publicBaseUrl ??
		`http://${options.host ?? "127.0.0.1"}:${options.port ?? 4000}`;
	const app = createPublicRuntimeApp({
		auth: options.auth,
		objectStore: options.objectStore,
		readiness: options.readiness,
		stateDir: options.stateDir,
	});

	return {
		app,
		server: http.createServer(createNodeRequestHandler(app, fallbackOrigin)),
	};
}
