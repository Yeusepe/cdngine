/**
 * Purpose: Starts the local Node.js public runtime server that exposes the CDNgine production upload-session and public-read contract for the public upload workspace.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
 * - https://hono.dev/docs
 * - https://nodejs.org/api/http.html
 * Tests:
 * - apps/demo/test/demo-api-app.test.mjs
 */

import {
	createPublicRuntimeReadinessMonitor,
	createPublicRuntimeServer,
	resolvePublicRuntimeAuthFromEnvironment,
	resolvePublicRuntimeAuthModeFromEnvironment,
	resolvePublicRuntimeObjectStoreFromEnvironment,
	resolvePublicRuntimePortFromEnvironment,
} from './public-runtime-app.mjs';

const PORT = resolvePublicRuntimePortFromEnvironment(process.env);
const stateDir = process.env.CDNGINE_PUBLIC_RUNTIME_STATE_DIR ?? '.cdngine-public-runtime';
const objectStore = resolvePublicRuntimeObjectStoreFromEnvironment(process.env);
const authMode = resolvePublicRuntimeAuthModeFromEnvironment(process.env);
const auth = resolvePublicRuntimeAuthFromEnvironment(process.env);
const readiness = createPublicRuntimeReadinessMonitor({
	authMode,
	environment: process.env,
	objectStore,
	storageMode: objectStore ? 'object-store' : 'local-files'
});
const { server } = createPublicRuntimeServer({
	auth,
	objectStore,
	port: PORT,
	publicBaseUrl: `http://localhost:${PORT}`,
	readiness,
	stateDir
});

function hasInfisicalRuntimeMarker() {
	return Boolean(
		process.env.INFISICAL_TOKEN ||
			process.env.INFISICAL_PROJECT_ID ||
			process.env.INFISICAL_ENVIRONMENT ||
			process.env.INFISICAL_ENVIRONMENT_SLUG,
	);
}

server.listen(PORT, () => {
	console.log(`CDNgine local public runtime -> http://localhost:${PORT}`);
	console.log(`CDNgine local public runtime state -> ${stateDir}`);
	if (objectStore) {
		console.log(
			`CDNgine local public runtime artifacts -> object-store bucket=${objectStore.bucket} prefix=${objectStore.prefix}`,
		);
	} else {
		console.warn(
			'CDNgine local public runtime artifacts -> local file fallback; set CDNGINE_PUBLIC_RUNTIME_STORAGE=object-store plus RustFS/S3 envs for bucket-backed bytes.',
		);
	}
	if (!hasInfisicalRuntimeMarker()) {
		console.warn(
			'Infisical marker env was not detected; verify this runtime was launched through Infisical before treating it as prod-like.',
		);
	}
});
