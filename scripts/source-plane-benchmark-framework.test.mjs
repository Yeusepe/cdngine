/**
 * Purpose: Defines the regression and contract tests for the rigorous source-plane benchmark framework before the helper implementation is wired into the engine runners.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/testing-strategy.md
 * - docs/format-agnostic-upstream-review.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://nodejs.org/api/fs.html
 * Tests:
 * - scripts/source-plane-benchmark-framework.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  hashMaterializedTree,
  listBenchmarkWorkloads,
  materializeBenchmarkVersion,
  summarizeWorkloadRuns
} from './source-plane-benchmark-framework.mjs';

test('listBenchmarkWorkloads returns a rigorous multi-workload matrix', () => {
  const workloads = listBenchmarkWorkloads();
  const ids = workloads.map((workload) => workload.id);

  assert.deepEqual(ids, ['single-large-binary', 'multi-file-module-tree', 'small-file-corpus']);
  assert.equal(workloads.every((workload) => workload.versions.base.length > 0), true);
  assert.equal(workloads.every((workload) => workload.versions.duplicate.length > 0), true);
  assert.equal(workloads.every((workload) => workload.versions.patch.length > 0), true);
  assert.equal(workloads.some((workload) => workload.versions.base.length > 1), true);
});

test('materializeBenchmarkVersion writes deterministic multi-file trees and reports logical sizes', () => {
  const workloads = listBenchmarkWorkloads();
  const moduleTree = workloads.find((workload) => workload.id === 'multi-file-module-tree');
  const rootA = mkdtempSync(join(tmpdir(), 'cdngine-benchmark-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'cdngine-benchmark-b-'));

  try {
    const materializedA = materializeBenchmarkVersion(rootA, moduleTree.versions.patch);
    const materializedB = materializeBenchmarkVersion(rootB, moduleTree.versions.patch);
    const digestMapA = hashMaterializedTree(rootA);
    const digestMapB = hashMaterializedTree(rootB);

    assert.equal(materializedA.fileCount, moduleTree.versions.patch.length);
    assert.equal(materializedA.fileCount > 1, true);
    assert.equal(materializedA.logicalByteLength > 0, true);
    assert.deepEqual(materializedA, materializedB);
    assert.deepEqual(digestMapA, digestMapB);
    assert.equal(readFileSync(join(rootA, moduleTree.versions.patch[0].relativePath)).length > 0, true);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test('summarizeWorkloadRuns computes size and speed summaries across repetitions', () => {
  const summary = summarizeWorkloadRuns([
    {
      base: { fileCount: 2, logicalByteLength: 100, storedByteLength: 90, durationMs: 10 },
      duplicate: { fileCount: 2, logicalByteLength: 100, storedByteLength: 5, durationMs: 4 },
      patch: { fileCount: 2, logicalByteLength: 100, storedByteLength: 20, durationMs: 6 },
      restore: { fileCount: 2, logicalByteLength: 100, durationMs: 3, verified: true }
    },
    {
      base: { fileCount: 2, logicalByteLength: 100, storedByteLength: 80, durationMs: 8 },
      duplicate: { fileCount: 2, logicalByteLength: 100, storedByteLength: 10, durationMs: 5 },
      patch: { fileCount: 2, logicalByteLength: 100, storedByteLength: 30, durationMs: 9 },
      restore: { fileCount: 2, logicalByteLength: 100, durationMs: 4, verified: true }
    }
  ]);

  assert.equal(summary.runs, 2);
  assert.equal(summary.base.storedByteLength.mean, 85);
  assert.equal(summary.duplicate.storedByteLength.min, 5);
  assert.equal(summary.patch.durationMs.max, 9);
  assert.equal(summary.restore.durationMs.mean, 3.5);
  assert.equal(summary.restore.allVerified, true);
});
