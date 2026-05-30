/**
 * Purpose: Locks the Docker public runtime startup script to the workspace build order needed by the API process.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/service-architecture.md
 * - docs/repository-layout.md
 * - docs/testing-strategy.md
 * External references:
 * - https://docs.npmjs.com/cli/using-npm/workspaces
 * - https://nodejs.org/api/test.html
 * Tests:
 * - scripts/runtime-start-contract.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8'));
}

function workspaceBuildIndex(script, workspaceName) {
  return script.indexOf(`npm run build -w ${workspaceName}`);
}

test('public runtime startup builds API workspace dependencies before the API package', () => {
  const demoPackage = readJson('apps/demo/package.json');
  const runtimeStart = demoPackage.scripts['runtime:start'];

  const expectedBuildOrder = [
    '@cdngine/auth',
    '@cdngine/observability',
    '@cdngine/capabilities',
    '@cdngine/storage',
    '@cdngine/api'
  ];

  for (const workspaceName of expectedBuildOrder) {
    assert.notEqual(
      workspaceBuildIndex(runtimeStart, workspaceName),
      -1,
      `runtime:start must build ${workspaceName}`
    );
  }

  const apiBuildIndex = workspaceBuildIndex(runtimeStart, '@cdngine/api');
  for (const dependencyName of expectedBuildOrder.slice(0, -1)) {
    assert.ok(
      workspaceBuildIndex(runtimeStart, dependencyName) < apiBuildIndex,
      `runtime:start must build ${dependencyName} before @cdngine/api`
    );
  }

  assert.match(runtimeStart, /node \.\/scripts\/start-public-runtime\.mjs$/);
});

test('API package declares every CDNgine workspace package imported by its public runtime', () => {
  const apiPackage = readJson('apps/api/package.json');
  const dependencies = apiPackage.dependencies ?? {};

  for (const workspaceName of [
    '@cdngine/auth',
    '@cdngine/observability',
    '@cdngine/capabilities',
    '@cdngine/storage'
  ]) {
    assert.equal(
      dependencies[workspaceName],
      '^0.1.0',
      `apps/api/package.json must declare ${workspaceName}`
    );
  }
});
