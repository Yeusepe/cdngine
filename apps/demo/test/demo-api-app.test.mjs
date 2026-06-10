/**
 * Purpose: Verifies that the local public runtime uses the production upload-session and public-read contract with a shared in-memory backing state.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://nodejs.org/api/http.html
 * - https://tus.io/protocols/resumable-upload
 * Tests:
 * - apps/demo/test/demo-api-app.test.mjs
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
	buildBearerHeaders,
	hashBearerTokenForServiceAccount,
} from "../../../packages/auth/dist/index.js";
import {
	createPublicRuntimeReadinessMonitor,
	createPublicRuntimeApp,
	createPublicRuntimeServer,
	resolvePublicRuntimeAuthFromEnvironment,
	resolvePublicRuntimePortFromEnvironment,
} from "../scripts/public-runtime-app.mjs";

class FakeS3Client {
	constructor() {
		this.commands = [];
		this.objects = new Map();
	}

	async send(command) {
		this.commands.push({
			input: command.input,
			name: command.constructor.name,
		});

		switch (command.constructor.name) {
			case "PutObjectCommand": {
				const body = Buffer.isBuffer(command.input.Body)
					? command.input.Body
					: Buffer.from(command.input.Body);
				this.objects.set(`${command.input.Bucket}/${command.input.Key}`, {
					body,
					contentType: command.input.ContentType,
					metadata: command.input.Metadata ?? {},
				});
				return { ETag: `"${command.input.Key}"` };
			}
			case "HeadObjectCommand": {
				const object = this.objects.get(
					`${command.input.Bucket}/${command.input.Key}`,
				);
				if (!object) {
					const error = new Error("No such key");
					error.name = "NoSuchKey";
					throw error;
				}
				return {
					ContentLength: object.body.length,
					ContentType: object.contentType,
					ETag: `"${command.input.Key}"`,
					LastModified: new Date("2026-05-01T00:00:00Z"),
					Metadata: object.metadata,
				};
			}
			case "GetObjectCommand": {
				const object = this.objects.get(
					`${command.input.Bucket}/${command.input.Key}`,
				);
				if (!object) {
					const error = new Error("No such key");
					error.name = "NoSuchKey";
					throw error;
				}
				return {
					Body: object.body,
					ContentLength: object.body.length,
					ContentType: object.contentType,
					Metadata: object.metadata,
				};
			}
			case "DeleteObjectCommand":
				this.objects.delete(`${command.input.Bucket}/${command.input.Key}`);
				return {};
			default:
				return {};
		}
	}
}

test("runtime port resolution honors Zeabur WEB_PORT when PORT is unresolved", () => {
	assert.equal(
		resolvePublicRuntimePortFromEnvironment({
			PORT: "${WEB_PORT}",
			WEB_PORT: "8080",
		}),
		8080,
	);
	assert.equal(resolvePublicRuntimePortFromEnvironment({ PORT: "5000" }), 5000);
});

test("runtime port resolution rejects invalid explicit port values", () => {
	assert.throws(
		() => resolvePublicRuntimePortFromEnvironment({ PORT: "not-a-port" }),
		/PORT must be a positive integer/,
	);
});

test("production public runtime auth requires configured service-account bearer tokens", () => {
	assert.throws(
		() =>
			resolvePublicRuntimeAuthFromEnvironment({
				NODE_ENV: "production",
			}),
		/CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON/,
	);
	assert.throws(
		() =>
			resolvePublicRuntimeAuthFromEnvironment({
				CDNGINE_DEPLOYMENT_PROFILE: "production-default",
				CDNGINE_PUBLIC_RUNTIME_AUTH_MODE: "local",
			}),
		/CDNGINE_PUBLIC_RUNTIME_AUTH_MODE=local/,
	);
});

test("production public runtime enforces service-account bearer auth before public routes", async () => {
	const serviceToken = "creator-assistant-runtime-token";
	const auth = resolvePublicRuntimeAuthFromEnvironment({
		CDNGINE_PUBLIC_RUNTIME_AUTH_MODE: "service-accounts",
		CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON: JSON.stringify([
			{
				allowedServiceNamespaces: ["yucp-backstage"],
				roles: ["public-user"],
				subject: "creator-assistant-api",
				tokenSha256: hashBearerTokenForServiceAccount(serviceToken),
			},
		]),
		NODE_ENV: "production",
	});
	const app = createPublicRuntimeApp({ auth });

	const unauthenticatedResponse = await app.request(
		"http://localhost/v1/upload-sessions",
		{
			body: "{}",
			headers: {
				"content-type": "application/json",
			},
			method: "POST",
		},
	);
	const authenticatedResponse = await app.request(
		"http://localhost/v1/upload-sessions",
		{
			body: "{}",
			headers: {
				...buildBearerHeaders(serviceToken),
				"content-type": "application/json",
			},
			method: "POST",
		},
	);

	assert.equal(unauthenticatedResponse.status, 401);
	assert.equal(authenticatedResponse.status, 400);
});

test("production public runtime readiness reports configured portable dependencies", async () => {
	const environment = {
		CDNGINE_DEPLOYMENT_PROFILE: "production-default",
		CDNGINE_READINESS_REQUIRED:
			"auth,source-repository,derived-store,exports-store",
		CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON: JSON.stringify([
			{
				roles: ["public-user"],
				subject: "creator-assistant-api",
				tokenSha256: hashBearerTokenForServiceAccount(
					"creator-assistant-runtime-token",
				),
			},
		]),
		NODE_ENV: "production",
	};
	const app = createPublicRuntimeApp({
		auth: resolvePublicRuntimeAuthFromEnvironment(environment),
		readiness: createPublicRuntimeReadinessMonitor({
			authMode: "service-accounts",
			environment,
			storageMode: "local-files",
		}),
	});

	const response = await app.request("http://localhost/readyz");
	const payload = await response.json();

	assert.equal(response.status, 200);
	assert.equal(payload.deploymentProfile, "production-default");
	assert.equal(payload.status, "ready");
	assert.deepEqual(
		payload.dependencies.map((dependency) => dependency.boundary),
		["auth", "source-repository", "derived-store", "exports-store"],
	);
});

test("local public runtime app exposes the production upload-session flow and shared staged-object reads", async () => {
	const app = createPublicRuntimeApp();

	const issueResponse = await app.request(
		"http://localhost/v1/upload-sessions",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "create-demo-upload",
			},
			body: JSON.stringify({
				assetOwner: "demo:user",
				serviceNamespaceId: "media-platform",
				source: {
					contentType: "text/plain",
					filename: "demo.txt",
				},
				upload: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey: "media-platform/demo.txt",
				},
			}),
		},
	);

	assert.equal(issueResponse.status, 201);
	const issued = await issueResponse.json();
	assert.equal(issued.uploadTarget.protocol, "tus");
	assert.equal(issued.uploadTarget.url, "/uploads/media-platform/demo.txt");

	const uploadTargetPath = new URL(
		issued.uploadTarget.url,
		"http://localhost",
	).toString();
	const preflightResponse = await app.request(uploadTargetPath, {
		method: "OPTIONS",
		headers: {
			origin: "http://localhost:3000",
			"access-control-request-method": "PATCH",
			"access-control-request-headers":
				"content-type,tus-resumable,upload-offset",
		},
	});

	assert.equal(preflightResponse.status, 204);
	assert.equal(
		preflightResponse.headers.get("access-control-allow-origin"),
		"http://localhost:3000",
	);
	assert.match(
		preflightResponse.headers.get("access-control-allow-headers") ?? "",
		/tus-resumable/i,
	);

	const patchResponse = await app.request(uploadTargetPath, {
		method: "PATCH",
		headers: {
			"content-type": "application/offset+octet-stream",
			"tus-resumable": "1.0.0",
			"upload-offset": "0",
		},
		body: "hello world!",
	});

	assert.equal(patchResponse.status, 204);

	const completeResponse = await app.request(
		`http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "complete-demo-upload",
			},
			body: JSON.stringify({
				stagedObject: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey: "media-platform/demo.txt",
				},
			}),
		},
	);

	assert.equal(completeResponse.status, 202);
	const completion = await completeResponse.json();

	const versionResponse = await app.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}`,
	);

	assert.equal(versionResponse.status, 200);
	const version = await versionResponse.json();
	assert.equal(version.lifecycleState, "published");
	assert.equal(version.workflowState, "completed");
	assert.equal(version.source.filename, "demo.txt");

	const sourceAuthorizeResponse = await app.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/source/authorize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "authorize-demo-source",
			},
			body: JSON.stringify({
				preferredDisposition: "attachment",
			}),
		},
	);

	assert.equal(sourceAuthorizeResponse.status, 200);
	const sourceAuthorization = await sourceAuthorizeResponse.json();
	assert.equal(sourceAuthorization.url, "/uploads/media-platform/demo.txt");

	const sourceDownloadResponse = await app.request(
		new URL(sourceAuthorization.url, "http://localhost").toString(),
	);

	assert.equal(sourceDownloadResponse.status, 200);
	assert.equal(await sourceDownloadResponse.text(), "hello world!");
});

test("local public runtime persists completed source reads across process-style restarts", async (context) => {
	const stateDir = await mkdtemp(path.join(tmpdir(), "cdngine-runtime-state-"));
	context.after(() => rm(stateDir, { force: true, recursive: true }));

	const firstApp = createPublicRuntimeApp({ stateDir });
	const issueResponse = await firstApp.request(
		"http://localhost/v1/upload-sessions",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "create-persistent-upload",
			},
			body: JSON.stringify({
				assetOwner: "demo:user",
				serviceNamespaceId: "media-platform",
				source: {
					contentType: "text/plain",
					filename: "persistent.txt",
				},
				upload: {
					byteLength: 19,
					checksum: {
						algorithm: "sha256",
						value:
							"3914f10cfcc373ef745ca6062ccdeb11aa91e7a503a222b365a7fdff0211a958",
					},
					objectKey: "media-platform/persistent.txt",
				},
			}),
		},
	);

	assert.equal(issueResponse.status, 201);
	const issued = await issueResponse.json();
	const uploadTargetPath = new URL(
		issued.uploadTarget.url,
		"http://localhost",
	).toString();
	const patchResponse = await firstApp.request(uploadTargetPath, {
		method: "PATCH",
		headers: {
			"content-type": "application/offset+octet-stream",
			"tus-resumable": "1.0.0",
			"upload-offset": "0",
		},
		body: "persistent runtime!",
	});

	assert.equal(patchResponse.status, 204);

	const completeResponse = await firstApp.request(
		`http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "complete-persistent-upload",
			},
			body: JSON.stringify({
				stagedObject: {
					byteLength: 19,
					checksum: {
						algorithm: "sha256",
						value:
							"3914f10cfcc373ef745ca6062ccdeb11aa91e7a503a222b365a7fdff0211a958",
					},
					objectKey: "media-platform/persistent.txt",
				},
			}),
		},
	);

	assert.equal(completeResponse.status, 202);
	const completion = await completeResponse.json();

	const restartedApp = createPublicRuntimeApp({ stateDir });
	const sourceAuthorizeResponse = await restartedApp.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/source/authorize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "authorize-restarted-source",
			},
			body: JSON.stringify({
				preferredDisposition: "attachment",
			}),
		},
	);

	assert.equal(sourceAuthorizeResponse.status, 200);
	const sourceAuthorization = await sourceAuthorizeResponse.json();
	const sourceDownloadResponse = await restartedApp.request(
		new URL(sourceAuthorization.url, "http://localhost").toString(),
	);

	assert.equal(sourceDownloadResponse.status, 200);
	assert.equal(await sourceDownloadResponse.text(), "persistent runtime!");
});

test("local public runtime maps persisted published versions to delivery-ready reads after restart", async (context) => {
	const stateDir = await mkdtemp(path.join(tmpdir(), "cdngine-runtime-published-state-"));
	context.after(() => rm(stateDir, { force: true, recursive: true }));

	const firstApp = createPublicRuntimeApp({ stateDir });
	const issueResponse = await firstApp.request(
		"http://localhost/v1/upload-sessions",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "create-published-upload",
			},
			body: JSON.stringify({
				assetOwner: "demo:user",
				serviceNamespaceId: "media-platform",
				source: {
					contentType: "application/zip",
					filename: "published.zip",
				},
				upload: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey: "media-platform/published.zip",
				},
			}),
		},
	);

	assert.equal(issueResponse.status, 201);
	const issued = await issueResponse.json();
	await firstApp.request(new URL(issued.uploadTarget.url, "http://localhost").toString(), {
		method: "PATCH",
		headers: {
			"content-type": "application/offset+octet-stream",
			"tus-resumable": "1.0.0",
			"upload-offset": "0",
		},
		body: "hello world!",
	});
	const completeResponse = await firstApp.request(
		`http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "complete-published-upload",
			},
			body: JSON.stringify({
				stagedObject: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey: "media-platform/published.zip",
				},
			}),
		},
	);
	const completion = await completeResponse.json();

	const restartedApp = createPublicRuntimeApp({ stateDir });
	const deliveryAuthorizeResponse = await restartedApp.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/deliveries/paid-downloads/authorize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "authorize-published-delivery",
			},
			body: JSON.stringify({
				responseFormat: "url",
				variant: "preserve-original",
			}),
		},
	);

	assert.equal(deliveryAuthorizeResponse.status, 200);
	const deliveryAuthorization = await deliveryAuthorizeResponse.json();
	assert.equal(
		deliveryAuthorization.url,
		`/uploads/deriv/media-platform/${completion.assetId}/${completion.versionId}/preserve-original/preserve-original`,
	);
});

test("local public runtime replays persisted pending generic dispatches after restart", async (context) => {
	const stateDir = await mkdtemp(path.join(tmpdir(), "cdngine-runtime-pending-state-"));
	context.after(() => rm(stateDir, { force: true, recursive: true }));

	const firstApp = createPublicRuntimeApp({ stateDir });
	const issueResponse = await firstApp.request(
		"http://localhost/v1/upload-sessions",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "create-pending-upload",
			},
			body: JSON.stringify({
				assetOwner: "demo:user",
				serviceNamespaceId: "media-platform",
				source: {
					contentType: "application/zip",
					filename: "pending.zip",
				},
				upload: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey: "media-platform/pending.zip",
				},
			}),
		},
	);

	assert.equal(issueResponse.status, 201);
	const issued = await issueResponse.json();
	await firstApp.request(new URL(issued.uploadTarget.url, "http://localhost").toString(), {
		method: "PATCH",
		headers: {
			"content-type": "application/offset+octet-stream",
			"tus-resumable": "1.0.0",
			"upload-offset": "0",
		},
		body: "hello world!",
	});
	const completeResponse = await firstApp.request(
		`http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "complete-pending-upload",
			},
			body: JSON.stringify({
				stagedObject: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey: "media-platform/pending.zip",
				},
			}),
		},
	);
	const completion = await completeResponse.json();

	const stateFile = path.join(stateDir, "upload-session-store.json");
	const state = JSON.parse(await readFile(stateFile, "utf8"));
	for (const entry of state.versionsById) {
		if (entry[0] === completion.versionId) {
			entry[1].lifecycleState = "canonical";
			entry[1].workflowDispatch.state = "pending";
		}
	}
	state.publishedDerivatives = [];
	state.publishedManifests = [];
	await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");

	const restartedApp = createPublicRuntimeApp({ stateDir });
	const versionResponse = await restartedApp.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}`,
	);

	assert.equal(versionResponse.status, 200);
	const version = await versionResponse.json();
	assert.equal(version.lifecycleState, "published");
	assert.equal(version.workflowState, "completed");

	const deliveryAuthorizeResponse = await restartedApp.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/deliveries/paid-downloads/authorize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "authorize-replayed-delivery",
			},
			body: JSON.stringify({
				responseFormat: "url",
				variant: "preserve-original",
			}),
		},
	);

	assert.equal(deliveryAuthorizeResponse.status, 200);
	const deliveryAuthorization = await deliveryAuthorizeResponse.json();
	assert.equal(
		deliveryAuthorization.url,
		`/uploads/deriv/media-platform/${completion.assetId}/${completion.versionId}/preserve-original/preserve-original`,
	);
});

test("local public runtime publishes completed generic uploads into delivery reads", async (context) => {
	const stateDir = await mkdtemp(path.join(tmpdir(), "cdngine-runtime-delivery-state-"));
	context.after(() => rm(stateDir, { force: true, recursive: true }));

	const app = createPublicRuntimeApp({ stateDir });
	const issueResponse = await app.request(
		"http://localhost/v1/upload-sessions",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "create-delivery-upload",
			},
			body: JSON.stringify({
				assetOwner: "creator:auth-user-1",
				serviceNamespaceId: "yucp-backstage",
				tenantId: "auth-user-1",
				source: {
					contentType: "application/zip",
					filename: "vrc-get-com.yucp.club-1.0.12.zip",
				},
				upload: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey:
						"staging/yucp-backstage/auth-user-1/backstage/com.yucp.club/1.0.12/vrc-get-com.yucp.club-1.0.12.zip",
				},
			}),
		},
	);

	assert.equal(issueResponse.status, 201);
	const issued = await issueResponse.json();
	const uploadTargetUrl = new URL(
		issued.uploadTarget.url,
		"http://localhost",
	).toString();
	const patchResponse = await app.request(uploadTargetUrl, {
		method: "PATCH",
		headers: {
			"content-type": "application/offset+octet-stream",
			"tus-resumable": "1.0.0",
			"upload-offset": "0",
		},
		body: "hello world!",
	});

	assert.equal(patchResponse.status, 204);

	const completeResponse = await app.request(
		`http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "complete-delivery-upload",
			},
			body: JSON.stringify({
				stagedObject: {
					byteLength: 12,
					checksum: {
						algorithm: "sha256",
						value:
							"7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9",
					},
					objectKey:
						"staging/yucp-backstage/auth-user-1/backstage/com.yucp.club/1.0.12/vrc-get-com.yucp.club-1.0.12.zip",
				},
			}),
		},
	);

	assert.equal(completeResponse.status, 202);
	const completion = await completeResponse.json();

	const versionResponse = await app.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}`,
	);

	assert.equal(versionResponse.status, 200);
	const version = await versionResponse.json();
	assert.equal(version.lifecycleState, "published");
	assert.equal(version.workflowState, "completed");

	const derivativesResponse = await app.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/derivatives`,
	);

	assert.equal(derivativesResponse.status, 200);
	const derivatives = await derivativesResponse.json();
	assert.deepEqual(
		derivatives.derivatives.map((derivative) => derivative.variant),
		["preserve-original"],
	);

	const deliveryAuthorizeResponse = await app.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/deliveries/paid-downloads/authorize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "authorize-delivery-upload",
			},
			body: JSON.stringify({
				responseFormat: "url",
				variant: "preserve-original",
			}),
		},
	);

	assert.equal(deliveryAuthorizeResponse.status, 200);
	const deliveryAuthorization = await deliveryAuthorizeResponse.json();
	assert.equal(
		deliveryAuthorization.url,
		`/uploads/deriv/yucp-backstage/${completion.assetId}/${completion.versionId}/preserve-original/preserve-original`,
	);

	const deliveryDownloadResponse = await app.request(
		new URL(deliveryAuthorization.url, "http://localhost").toString(),
	);

	assert.equal(deliveryDownloadResponse.status, 200);
	assert.equal(await deliveryDownloadResponse.text(), "hello world!");
});

test("local public runtime can back uploaded bytes with the ingest object-store bucket", async () => {
	const s3Client = new FakeS3Client();
	const app = createPublicRuntimeApp({
		objectStore: {
			bucket: "cdngine-staging",
			client: s3Client,
			prefix: "uploads",
		},
	});

	const issueResponse = await app.request(
		"http://localhost/v1/upload-sessions",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "create-bucket-upload",
			},
			body: JSON.stringify({
				assetOwner: "demo:user",
				serviceNamespaceId: "media-platform",
				source: {
					contentType: "text/plain",
					filename: "bucket.txt",
				},
				upload: {
					byteLength: 14,
					checksum: {
						algorithm: "sha256",
						value:
							"c9768766e6c313c1d37ea26084afd17ace731890484846189e2b74a81ec5e4a6",
					},
					objectKey: "media-platform/bucket.txt",
				},
			}),
		},
	);

	assert.equal(issueResponse.status, 201);
	const issued = await issueResponse.json();

	const patchResponse = await app.request(
		new URL(issued.uploadTarget.url, "http://localhost").toString(),
		{
			method: "PATCH",
			headers: {
				"content-type": "application/offset+octet-stream",
				"tus-resumable": "1.0.0",
				"upload-offset": "0",
			},
			body: "bucket-backed!",
		},
	);

	assert.equal(patchResponse.status, 204);
	assert.ok(
		s3Client.objects.has("cdngine-staging/uploads/media-platform/bucket.txt"),
	);

	const completeResponse = await app.request(
		`http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "complete-bucket-upload",
			},
			body: JSON.stringify({
				stagedObject: {
					byteLength: 14,
					checksum: {
						algorithm: "sha256",
						value:
							"c9768766e6c313c1d37ea26084afd17ace731890484846189e2b74a81ec5e4a6",
					},
					objectKey: "media-platform/bucket.txt",
				},
			}),
		},
	);

	assert.equal(completeResponse.status, 202);
	const completion = await completeResponse.json();

	const sourceAuthorizeResponse = await app.request(
		`http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/source/authorize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "authorize-bucket-source",
			},
			body: JSON.stringify({
				preferredDisposition: "attachment",
			}),
		},
	);

	assert.equal(sourceAuthorizeResponse.status, 200);
	const sourceAuthorization = await sourceAuthorizeResponse.json();
	const sourceDownloadResponse = await app.request(
		new URL(sourceAuthorization.url, "http://localhost").toString(),
	);

	assert.equal(sourceDownloadResponse.status, 200);
	assert.equal(await sourceDownloadResponse.text(), "bucket-backed!");
	assert.deepEqual(
		s3Client.commands.map((command) => command.name),
		[
			"PutObjectCommand",
			"HeadObjectCommand",
			"GetObjectCommand",
			"PutObjectCommand",
			"PutObjectCommand",
			"GetObjectCommand",
			"HeadObjectCommand",
		],
	);
});

test("local public runtime server bridges node http requests into the production public contract", async (context) => {
	const { server } = createPublicRuntimeServer({
		host: "127.0.0.1",
	});

	context.after(
		() =>
			new Promise((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			}),
	);

	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error(
			"Expected the public runtime server to listen on an address object.",
		);
	}
	const baseUrl = `http://127.0.0.1:${address.port}`;

	const issueResponse = await fetch(`${baseUrl}/v1/upload-sessions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": "create-node-runtime-upload",
		},
		body: JSON.stringify({
			assetOwner: "demo:user",
			serviceNamespaceId: "media-platform",
			source: {
				contentType: "text/plain",
				filename: "node-runtime.txt",
			},
			upload: {
				byteLength: 17,
				checksum: {
					algorithm: "sha256",
					value:
						"8372dfd02a41404fd6d02837458e4aa828d4dbe316cbc4dd077c112fac0a8c0a",
				},
				objectKey: "media-platform/node-runtime.txt",
			},
		}),
	});

	assert.equal(issueResponse.status, 201);
	const issued = await issueResponse.json();

	const uploadTargetUrl = new URL(issued.uploadTarget.url, baseUrl).toString();
	const patchResponse = await fetch(uploadTargetUrl, {
		method: "PATCH",
		headers: {
			"content-type": "application/offset+octet-stream",
			"tus-resumable": "1.0.0",
			"upload-offset": "0",
		},
		body: "runtime assembly!",
	});

	assert.equal(patchResponse.status, 204);

	const uploadHeadResponse = await fetch(uploadTargetUrl, {
		method: "HEAD",
	});

	assert.equal(uploadHeadResponse.status, 204);
	assert.equal(uploadHeadResponse.headers.get("upload-offset"), "17");
	assert.equal(uploadHeadResponse.headers.get("tus-resumable"), "1.0.0");

	const completeResponse = await fetch(
		`${baseUrl}/v1/upload-sessions/${issued.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "complete-node-runtime-upload",
			},
			body: JSON.stringify({
				stagedObject: {
					byteLength: 17,
					checksum: {
						algorithm: "sha256",
						value:
							"8372dfd02a41404fd6d02837458e4aa828d4dbe316cbc4dd077c112fac0a8c0a",
					},
					objectKey: "media-platform/node-runtime.txt",
				},
			}),
		},
	);

	assert.equal(completeResponse.status, 202);
	const completion = await completeResponse.json();

	const versionResponse = await fetch(
		`${baseUrl}/v1/assets/${completion.assetId}/versions/${completion.versionId}`,
	);

	assert.equal(versionResponse.status, 200);
	assert.equal(
		(await versionResponse.json()).source.filename,
		"node-runtime.txt",
	);

	const sourceAuthorizeResponse = await fetch(
		`${baseUrl}/v1/assets/${completion.assetId}/versions/${completion.versionId}/source/authorize`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": "authorize-node-runtime-source",
			},
			body: JSON.stringify({
				preferredDisposition: "attachment",
			}),
		},
	);

	assert.equal(sourceAuthorizeResponse.status, 200);
	const sourceAuthorization = await sourceAuthorizeResponse.json();
	const downloadResponse = await fetch(
		new URL(sourceAuthorization.url, baseUrl).toString(),
	);

	assert.equal(downloadResponse.status, 200);
	assert.equal(await downloadResponse.text(), "runtime assembly!");
});
