/**
 * Purpose: Runs the rigorous multi-workload source-plane benchmark suite through a local Kopia repository so CDNgine can compare snapshot-repository size, speed, and restore behavior across repeated runs.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/testing-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * External references:
 * - https://kopia.io/docs/reference/command-line/common/snapshot-create/
 * - https://kopia.io/docs/reference/command-line/common/snapshot-restore/
 * Tests:
 * - scripts/source-plane-benchmark-framework.test.mjs
 */

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  hashMaterializedTree,
  listBenchmarkWorkloads,
  materializeBenchmarkVersion,
  summarizeWorkloadRuns
} from './source-plane-benchmark-framework.mjs';

function resolveKopiaExecutable() {
  return resolve(process.env.CDNGINE_KOPIA_EXECUTABLE ?? 'kopia');
}

function getRepetitions() {
  const value = Number(process.env.CDNGINE_SOURCE_BENCHMARK_REPETITIONS ?? '3');

  return Number.isInteger(value) && value > 0 ? value : 3;
}

function runKopia(executable, args, env) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Kopia command failed: ${args.join(' ')}`);
  }

  return result.stdout;
}

function runKopiaJson(executable, args, env) {
  return JSON.parse(runKopia(executable, args, env));
}

function getDirectorySize(path) {
  let total = 0;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);

    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
      continue;
    }

    total += statSync(fullPath).size;
  }

  return total;
}

function runWorkload(workload, repetition, executable) {
  const workspace = mkdtempSync(join(tmpdir(), `cdngine-kopia-suite-${workload.id}-${repetition}-`));
  const repositoryDirectory = join(workspace, 'repo');
  const baseDirectory = join(workspace, 'base');
  const duplicateDirectory = join(workspace, 'duplicate');
  const patchDirectory = join(workspace, 'patch');
  const restoreDirectory = join(workspace, 'restore');
  const configFile = join(workspace, 'repository.config');
  const env = {
    KOPIA_CHECK_FOR_UPDATES: 'false'
  };

  try {
    mkdirSync(repositoryDirectory, { recursive: true });
    mkdirSync(restoreDirectory, { recursive: true });
    const base = materializeBenchmarkVersion(baseDirectory, workload.versions.base);
    const duplicate = materializeBenchmarkVersion(duplicateDirectory, workload.versions.duplicate);
    const patch = materializeBenchmarkVersion(patchDirectory, workload.versions.patch);

    runKopia(
      executable,
      [
        'repository',
        'create',
        'filesystem',
        `--path=${repositoryDirectory}`,
        `--config-file=${configFile}`,
        '--password=benchmark-pass'
      ],
      env
    );

    const afterCreateBytes = getDirectorySize(repositoryDirectory);

    const baseStartedAt = performance.now();
    runKopiaJson(
      executable,
      [
        'snapshot',
        'create',
        baseDirectory,
        `--config-file=${configFile}`,
        '--password=benchmark-pass',
        '--json',
        '--description',
        `${workload.id}-base-${repetition}`
      ],
      env
    );
    const baseDurationMs = performance.now() - baseStartedAt;
    const afterBaseBytes = getDirectorySize(repositoryDirectory);

    const duplicateStartedAt = performance.now();
    runKopiaJson(
      executable,
      [
        'snapshot',
        'create',
        duplicateDirectory,
        `--config-file=${configFile}`,
        '--password=benchmark-pass',
        '--json',
        '--description',
        `${workload.id}-duplicate-${repetition}`
      ],
      env
    );
    const duplicateDurationMs = performance.now() - duplicateStartedAt;
    const afterDuplicateBytes = getDirectorySize(repositoryDirectory);

    const patchStartedAt = performance.now();
    const patchSnapshot = runKopiaJson(
      executable,
      [
        'snapshot',
        'create',
        patchDirectory,
        `--config-file=${configFile}`,
        '--password=benchmark-pass',
        '--json',
        '--description',
        `${workload.id}-patch-${repetition}`
      ],
      env
    );
    const patchDurationMs = performance.now() - patchStartedAt;
    const afterPatchBytes = getDirectorySize(repositoryDirectory);

    const restoreStartedAt = performance.now();
    runKopia(
      executable,
      [
        'snapshot',
        'restore',
        patchSnapshot.id,
        restoreDirectory,
        `--config-file=${configFile}`,
        '--password=benchmark-pass'
      ],
      env
    );
    const restoreDurationMs = performance.now() - restoreStartedAt;

    return {
      base: {
        fileCount: base.fileCount,
        logicalByteLength: base.logicalByteLength,
        storedByteLength: afterBaseBytes - afterCreateBytes,
        durationMs: baseDurationMs
      },
      duplicate: {
        fileCount: duplicate.fileCount,
        logicalByteLength: duplicate.logicalByteLength,
        storedByteLength: afterDuplicateBytes - afterBaseBytes,
        durationMs: duplicateDurationMs
      },
      patch: {
        fileCount: patch.fileCount,
        logicalByteLength: patch.logicalByteLength,
        storedByteLength: afterPatchBytes - afterDuplicateBytes,
        durationMs: patchDurationMs
      },
      restore: {
        fileCount: patch.fileCount,
        logicalByteLength: patch.logicalByteLength,
        durationMs: restoreDurationMs,
        verified:
          JSON.stringify(hashMaterializedTree(restoreDirectory)) === JSON.stringify(hashMaterializedTree(patchDirectory))
      }
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

const executable = resolveKopiaExecutable();
const repetitions = getRepetitions();
const workloads = listBenchmarkWorkloads();

process.stdout.write(
  JSON.stringify(
    {
      engine: 'kopia',
      category: 'snapshot repository',
      metricMode:
        'repository growth on disk, which is reproducible and comparable but can overstate per-archive patch storage because it includes pack/index churn rather than only native chunk reuse.',
      repetitions,
      workloads: workloads.map((workload) => {
        const runs = Array.from({ length: repetitions }, (_, repetition) => runWorkload(workload, repetition + 1, executable));

        return {
          id: workload.id,
          title: workload.title,
          description: workload.description,
          runs,
          summary: summarizeWorkloadRuns(runs)
        };
      })
    },
    null,
    2
  )
);
