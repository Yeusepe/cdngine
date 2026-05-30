/**
 * Purpose: Removes generated repository outputs that can make fresh builds non-deterministic.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/fs.html
 * - https://www.typescriptlang.org/tsconfig/incremental.html
 * Tests:
 * - scripts/clean.test.mjs
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const targets = [
  'contracts\\dist',
  'dist',
  'coverage',
  'apps\\api\\dist',
  'apps\\api\\tsconfig.tsbuildinfo',
  'apps\\operator\\dist',
  'apps\\operator\\tsconfig.tsbuildinfo',
  'apps\\workers\\dist',
  'apps\\workers\\tsconfig.tsbuildinfo',
  'packages\\auth\\dist',
  'packages\\auth\\tsconfig.tsbuildinfo',
  'packages\\capabilities\\dist',
  'packages\\capabilities\\tsconfig.tsbuildinfo',
  'packages\\sdk\\dist',
  'packages\\sdk\\tsconfig.tsbuildinfo',
  'packages\\manifests\\dist',
  'packages\\manifests\\tsconfig.tsbuildinfo',
  'packages\\observability\\dist',
  'packages\\observability\\tsconfig.tsbuildinfo',
  'packages\\registry\\dist',
  'packages\\registry\\tsconfig.tsbuildinfo',
  'packages\\storage\\dist',
  'packages\\storage\\tsconfig.tsbuildinfo',
  'packages\\testing\\dist',
  'packages\\testing\\tsconfig.tsbuildinfo',
  'packages\\workflows\\dist',
  'packages\\workflows\\tsconfig.tsbuildinfo'
];

export function getCleanTargets(root = process.cwd()) {
  return targets.map((target) => join(root, target));
}

export function cleanRepository(root = process.cwd()) {
  for (const fullPath of getCleanTargets(root)) {
    if (existsSync(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanRepository();
}
