/**
 * Purpose: Validates clean removes TypeScript emit state and build outputs together.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://www.typescriptlang.org/tsconfig/incremental.html
 * Tests:
 * - scripts/clean.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cleanRepository, getCleanTargets } from './clean.mjs';

test('getCleanTargets includes workspace dist directories and TypeScript build info', () => {
  const targets = getCleanTargets('C:\\repo');

  assert.ok(targets.includes('C:\\repo\\packages\\auth\\dist'));
  assert.ok(targets.includes('C:\\repo\\packages\\auth\\tsconfig.tsbuildinfo'));
  assert.ok(targets.includes('C:\\repo\\apps\\api\\dist'));
  assert.ok(targets.includes('C:\\repo\\apps\\api\\tsconfig.tsbuildinfo'));
});

test('cleanRepository removes dist outputs and matching build info without touching node_modules state', () => {
  const root = mkdtempSync(join(tmpdir(), 'cdngine-clean-'));
  const packageDirectory = join(root, 'packages', 'auth');
  const nodeModulesDirectory = join(root, 'node_modules', 'dependency');

  mkdirSync(join(packageDirectory, 'dist'), { recursive: true });
  mkdirSync(nodeModulesDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, 'dist', 'index.js'), '');
  writeFileSync(join(packageDirectory, 'tsconfig.tsbuildinfo'), '');
  writeFileSync(join(nodeModulesDirectory, 'tsconfig.tsbuildinfo'), '');

  cleanRepository(root);

  assert.equal(existsSync(join(packageDirectory, 'dist')), false);
  assert.equal(existsSync(join(packageDirectory, 'tsconfig.tsbuildinfo')), false);
  assert.equal(existsSync(join(nodeModulesDirectory, 'tsconfig.tsbuildinfo')), true);
});
