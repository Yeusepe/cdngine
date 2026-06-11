/**
 * Purpose: Validates the portable Docker instance helper without requiring Docker to run.
 * Governing docs:
 * - README.md
 * - deploy/local-platform/README.md
 * - docs/environment-and-deployment.md
 * - docs/testing-strategy.md
 * External references:
 * - https://docs.docker.com/reference/cli/docker/compose/
 * - https://nodejs.org/api/test.html
 * Tests:
 * - scripts/docker-instance.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDockerInstanceArgs, getDockerInstancePaths } from './docker-instance.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('getDockerInstancePaths derives the base and overlay Compose files', () => {
  const paths = getDockerInstancePaths('C:\\repo');

  assert.equal(paths.localPlatformDirectory, 'C:\\repo\\deploy\\local-platform');
  assert.equal(paths.envFile, 'C:\\repo\\deploy\\local-platform\\.env');
  assert.equal(paths.composeFile, 'C:\\repo\\deploy\\local-platform\\compose.fast-start.yaml');
  assert.equal(paths.instanceComposeFile, 'C:\\repo\\deploy\\local-platform\\compose.instance.yaml');
});

test('buildDockerInstanceArgs starts the runtime image with the local dependency stack', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'cdngine-docker-instance-'));
  const paths = getDockerInstancePaths(temporaryRoot);

  try {
    mkdirSync(paths.localPlatformDirectory, { recursive: true });
    writeFileSync(paths.envFile, 'demo=true\n');

    assert.deepEqual(buildDockerInstanceArgs('up', paths), [
      'compose',
      '--env-file',
      paths.envFile,
      '-f',
      paths.composeFile,
      '-f',
      paths.instanceComposeFile,
      'up',
      '-d',
      '--build',
      'cdngine-runtime'
    ]);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('buildDockerInstanceArgs starts the UI demo only when explicitly requested', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'cdngine-docker-instance-'));
  const paths = getDockerInstancePaths(temporaryRoot);

  try {
    mkdirSync(paths.localPlatformDirectory, { recursive: true });
    writeFileSync(paths.envFile, 'demo=true\n');

    assert.deepEqual(buildDockerInstanceArgs('up-demo', paths), [
      'compose',
      '--env-file',
      paths.envFile,
      '-f',
      paths.composeFile,
      '-f',
      paths.instanceComposeFile,
      '--profile',
      'demo',
      'up',
      '-d',
      '--build',
      'cdngine-runtime',
      'cdngine-demo'
    ]);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('buildDockerInstanceArgs uses the same Compose project files for config and shutdown', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'cdngine-docker-instance-'));
  const paths = getDockerInstancePaths(temporaryRoot);

  try {
    mkdirSync(paths.localPlatformDirectory, { recursive: true });
    writeFileSync(paths.envFile, 'demo=true\n');

    assert.deepEqual(buildDockerInstanceArgs('config', paths), [
      'compose',
      '--env-file',
      paths.envFile,
      '-f',
      paths.composeFile,
      '-f',
      paths.instanceComposeFile,
      'config'
    ]);

    assert.deepEqual(buildDockerInstanceArgs('down', paths), [
      'compose',
      '--env-file',
      paths.envFile,
      '-f',
      paths.composeFile,
      '-f',
      paths.instanceComposeFile,
      'down',
      '--remove-orphans'
    ]);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('fast-start bucket creation is resolved from container environment defaults', () => {
  const composeFile = readFileSync(
    join(repositoryRoot, 'deploy', 'local-platform', 'compose.fast-start.yaml'),
    'utf8'
  );

  assert.match(composeFile, /--bucket "\$\$SOURCE_BUCKET"/);
  assert.doesNotMatch(composeFile, /--bucket "\$SOURCE_BUCKET"/);
});

test('remote latest compose builds from GitHub without local bind mounts', () => {
  const composeFile = readFileSync(
    join(repositoryRoot, 'deploy', 'remote', 'compose.latest.yaml'),
    'utf8'
  );

  assert.match(composeFile, /context: https:\/\/github\.com\/Yeusepe\/cdngine\.git#main/);
  assert.match(composeFile, /cdngine-db-init:/);
  assert.doesNotMatch(composeFile, /\.\//);
  assert.doesNotMatch(composeFile, /\.\./);
  assert.match(composeFile, /cdngine-runtime:/);
});

test('runtime Dockerfile installs OpenSSL for Prisma database clients', () => {
  const dockerfile = readFileSync(join(repositoryRoot, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /apt-get update/);
  assert.match(dockerfile, /openssl/);
});
