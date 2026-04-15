/**
 * Purpose: Validates the cross-platform local-run helper without needing Docker or Vite in-process.
 * Governing docs:
 * - README.md
 * - deploy/local-platform/README.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://nodejs.org/api/fs.html
 * Tests:
 * - scripts/local-dev.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildComposeArgs,
  ensureLocalEnvFile,
  getLocalPlatformPaths,
  resolveExecutable
} from './local-dev.mjs';

test('resolveExecutable uses platform-appropriate command names', () => {
  assert.equal(resolveExecutable('npm', 'win32'), 'npm.cmd');
  assert.equal(resolveExecutable('npm', 'linux'), 'npm');
});

test('getLocalPlatformPaths derives the expected local-platform files', () => {
  const paths = getLocalPlatformPaths('C:\\repo');

  assert.equal(paths.localPlatformDirectory, 'C:\\repo\\deploy\\local-platform');
  assert.equal(paths.envFile, 'C:\\repo\\deploy\\local-platform\\.env');
  assert.equal(paths.exampleFile, 'C:\\repo\\deploy\\local-platform\\.env.example');
  assert.equal(paths.composeFile, 'C:\\repo\\deploy\\local-platform\\compose.fast-start.yaml');
});

test('buildComposeArgs includes env file and compose file for startup and shutdown', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'cdngine-local-dev-'));
  const paths = getLocalPlatformPaths(temporaryRoot);

  try {
    mkdirSync(paths.localPlatformDirectory, { recursive: true });
    writeFileSync(paths.exampleFile, 'demo=true\n');
    writeFileSync(paths.envFile, 'demo=true\n');

    assert.deepEqual(buildComposeArgs('up', paths), [
      'compose',
      '--env-file',
      paths.envFile,
      '-f',
      paths.composeFile,
      'up',
      '-d'
    ]);

    assert.deepEqual(buildComposeArgs('down', paths), [
      'compose',
      '--env-file',
      paths.envFile,
      '-f',
      paths.composeFile,
      'down',
      '--remove-orphans'
    ]);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('ensureLocalEnvFile seeds .env from .env.example once', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'cdngine-local-dev-'));
  const paths = getLocalPlatformPaths(temporaryRoot);

  try {
    mkdirSync(paths.localPlatformDirectory, { recursive: true });
    writeFileSync(paths.exampleFile, 'A=1\n');

    assert.equal(ensureLocalEnvFile(paths), true);
    assert.equal(existsSync(paths.envFile), true);
    assert.equal(readFileSync(paths.envFile, 'utf8'), 'A=1\n');

    writeFileSync(paths.envFile, 'A=2\n');
    assert.equal(ensureLocalEnvFile(paths), false);
    assert.equal(readFileSync(paths.envFile, 'utf8'), 'A=2\n');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
