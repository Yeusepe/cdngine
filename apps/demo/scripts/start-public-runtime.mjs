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
 * - https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate
 * Tests:
 * - apps/demo/test/demo-api-app.test.mjs
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	bootstrapDurablePublicRuntimeRegistry,
	createPublicRuntimeReadinessMonitor,
	createPublicRuntimeServer,
	createDurablePublicRuntimeDependencies,
	resolvePublicRuntimeAuthFromEnvironment,
	resolvePublicRuntimeAuthModeFromEnvironment,
	resolvePublicRuntimeObjectStoreFromEnvironment,
	resolvePublicRuntimePortFromEnvironment,
	resolvePublicRuntimeStateModeFromEnvironment,
} from './public-runtime-app.mjs';

function runDurableRegistryMigrationsIfNeeded(runtimeStateMode) {
	if (
		runtimeStateMode !== 'durable' ||
		process.env.CDNGINE_SKIP_REGISTRY_MIGRATIONS === 'true'
	) {
		return;
	}

	const databaseUrl = process.env.CDNGINE_DATABASE_URL ?? process.env.DATABASE_URL;
	if (!databaseUrl?.trim()) {
		throw new Error(
			'Durable public runtime requires CDNGINE_DATABASE_URL or DATABASE_URL before registry migrations can run.',
		);
	}

	const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const workspaceRoot = path.resolve(demoRoot, '..', '..');
	const registryRoot = path.join(workspaceRoot, 'packages', 'registry');
	const prismaCliPath = path.join(
		workspaceRoot,
		'node_modules',
		'prisma',
		'build',
		'index.js',
	);
	const schemaPath = path.join(registryRoot, 'prisma', 'schema.prisma');
	const result = spawnSync(
		process.execPath,
		[prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath],
		{
			cwd: registryRoot,
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
			},
			stdio: 'inherit',
		},
	);

	if (result.status !== 0) {
		throw new Error('Durable public runtime registry migration failed.');
	}
}

const PORT = resolvePublicRuntimePortFromEnvironment(process.env);
const runtimeStateMode = resolvePublicRuntimeStateModeFromEnvironment(process.env);
runDurableRegistryMigrationsIfNeeded(runtimeStateMode);
const stateDir =
	runtimeStateMode === 'local'
		? process.env.CDNGINE_PUBLIC_RUNTIME_STATE_DIR ?? '.cdngine-public-runtime'
		: undefined;
const objectStore =
	runtimeStateMode === 'local'
		? resolvePublicRuntimeObjectStoreFromEnvironment(process.env)
		: undefined;
const durableRuntime =
	runtimeStateMode === 'durable'
		? createDurablePublicRuntimeDependencies({ environment: process.env })
		: undefined;
const durableRegistryBootstrap = durableRuntime
	? await bootstrapDurablePublicRuntimeRegistry({
			durableRuntime,
			environment: process.env
		})
	: undefined;
const authMode = resolvePublicRuntimeAuthModeFromEnvironment(process.env);
const auth = resolvePublicRuntimeAuthFromEnvironment(process.env);
const readiness = createPublicRuntimeReadinessMonitor({
	authMode,
	durableRuntime,
	environment: process.env,
	objectStore,
	runtimeStateMode,
	storageMode:
		runtimeStateMode === 'durable' || objectStore ? 'object-store' : 'local-files'
});
const { server } = createPublicRuntimeServer({
	auth,
	durableRuntime,
	environment: process.env,
	objectStore,
	port: PORT,
	publicBaseUrl: `http://localhost:${PORT}`,
	readiness,
	runtimeStateMode,
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
	console.log(`CDNgine public runtime -> http://localhost:${PORT}`);
	console.log(`CDNgine public runtime state mode -> ${runtimeStateMode}`);
	if (stateDir) {
		console.log(`CDNgine local public runtime state -> ${stateDir}`);
	}
	if (durableRuntime) {
		console.log(
			`CDNgine durable public runtime artifacts -> object-store ingest=${durableRuntime.storageConfig.normalized.ingest.targetKey} source=${durableRuntime.storageConfig.normalized.source.targetKey}`,
		);
		console.log(
			`CDNgine durable registry bootstrap -> namespace=${durableRegistryBootstrap.serviceNamespaceId} deliveryScopes=${durableRegistryBootstrap.deliveryScopes.length}`,
		);
	} else if (objectStore) {
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
