/**
 * Purpose: Runs the rigorous source-plane benchmark suite across Xet-like, Kopia, Borg, and Oxen so contributors can compare repeated workload size, write-time, and restore-time behavior directly.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/environment-and-deployment.md
 * External references:
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://kopia.io/docs/features/
 * - https://borgbackup.readthedocs.io/en/stable/
 * - https://docs.oxen.ai/getting-started/versioning
 * Tests:
 * - Manual validation with `npm run benchmark:source-plane-compare`
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function runJson(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Benchmark script failed: ${scriptPath}`);
  }

  return JSON.parse(result.stdout);
}

const suites = [
  runJson(resolve('scripts', 'xet-benchmark-suite.mjs')),
  runJson(resolve('scripts', 'kopia-benchmark-suite.mjs')),
  runJson(resolve('scripts', 'borg-benchmark-suite.mjs')),
  runJson(resolve('scripts', 'oxen-benchmark-suite.mjs'))
];

function summarizeEngine(suite) {
  return {
    engine: suite.engine,
    category: suite.category,
    metricMode: suite.metricMode,
    repetitions: suite.repetitions,
    totalBaseStoredByteLength: suite.workloads.reduce(
      (sum, workload) => sum + workload.summary.base.storedByteLength.mean,
      0
    ),
    totalDuplicateStoredByteLength: suite.workloads.reduce(
      (sum, workload) => sum + workload.summary.duplicate.storedByteLength.mean,
      0
    ),
    totalPatchStoredByteLength: suite.workloads.reduce(
      (sum, workload) => sum + workload.summary.patch.storedByteLength.mean,
      0
    ),
    totalBaseDurationMs: suite.workloads.reduce(
      (sum, workload) => sum + workload.summary.base.durationMs.mean,
      0
    ),
    totalDuplicateDurationMs: suite.workloads.reduce(
      (sum, workload) => sum + workload.summary.duplicate.durationMs.mean,
      0
    ),
    totalPatchDurationMs: suite.workloads.reduce(
      (sum, workload) => sum + workload.summary.patch.durationMs.mean,
      0
    ),
    totalRestoreDurationMs: suite.workloads.reduce(
      (sum, workload) => sum + workload.summary.restore.durationMs.mean,
      0
    ),
    allRestoreVerified: suite.workloads.every((workload) => workload.summary.restore.allVerified)
  };
}

const engineSummaries = suites.map(summarizeEngine);

function createRanking(selector, suitesToRank = engineSummaries) {
  return [...suitesToRank]
    .sort((left, right) => selector(left) - selector(right))
    .map((summary, index) => ({
      rank: index + 1,
      engine: summary.engine,
      category: summary.category,
      metricMode: summary.metricMode,
      value: selector(summary)
    }));
}

process.stdout.write(
  JSON.stringify(
    {
      workloads: suites[0].workloads.map((workload) => ({
        id: workload.id,
        title: workload.title,
        description: workload.description
      })),
      engines: Object.fromEntries(suites.map((suite) => [suite.engine, suite])),
      engineSummaries,
      rankings: {
        byPatchStoredByteLength: createRanking((summary) => summary.totalPatchStoredByteLength),
        byDuplicateStoredByteLength: createRanking((summary) => summary.totalDuplicateStoredByteLength),
        byPatchDurationMs: createRanking((summary) => summary.totalPatchDurationMs),
        byRestoreDurationMs: createRanking((summary) => summary.totalRestoreDurationMs)
      },
      outOfCategoryCandidates: [
        {
          engine: 'lakefs',
          reason:
            'lakeFS versions object-storage metadata and pointers, but it is not a byte-level near-duplicate dedupe engine, so it is excluded from the cross-engine size rankings for this benchmark matrix.'
        }
      ]
    },
    null,
    2
  )
);
