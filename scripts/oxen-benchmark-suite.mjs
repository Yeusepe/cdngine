/**
 * Purpose: Runs the rigorous multi-workload source-plane benchmark suite through a local Oxen repository so CDNgine can compare version-store growth, write speed, and restore behavior across repeated runs.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/testing-strategy.md
 * - docs/format-agnostic-upstream-review.md
 * External references:
 * - https://docs.oxen.ai/getting-started/install
 * - https://docs.oxen.ai/getting-started/versioning
 * Tests:
 * - scripts/source-plane-benchmark-framework.test.mjs
 */

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  hashMaterializedTree,
  listBenchmarkWorkloads,
  materializeBenchmarkVersion,
  summarizeWorkloadRuns
} from './source-plane-benchmark-framework.mjs';

function resolveOxenExecutable() {
  return resolve(process.env.CDNGINE_OXEN_EXECUTABLE ?? 'oxen');
}

function getRepetitions() {
  const value = Number(process.env.CDNGINE_SOURCE_BENCHMARK_REPETITIONS ?? '3');

  return Number.isInteger(value) && value > 0 ? value : 3;
}

function runOxen(executable, args, cwd, configDirectory) {
  const result = spawnSync(executable, ['--config-dir', configDirectory, ...args], {
    cwd,
    encoding: 'utf8'
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

  if (result.status !== 0) {
    throw new Error(output || `Oxen command failed: ${args.join(' ')}`);
  }

  return output;
}

function parseCommitId(output) {
  const match = output.match(/commit ([0-9a-f]{7,64}) ->/i);

  if (!match) {
    throw new Error(`Could not parse Oxen commit id from output:\n${output}`);
  }

  return match[1];
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

function clearRepositoryWorkingTree(repositoryRoot) {
  for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
    if (entry.name === '.oxen') {
      continue;
    }

    rmSync(join(repositoryRoot, entry.name), { recursive: true, force: true });
  }
}

function syncVersionIntoRepository(repositoryRoot, sourceDirectory) {
  clearRepositoryWorkingTree(repositoryRoot);

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    cpSync(join(sourceDirectory, entry.name), join(repositoryRoot, entry.name), {
      recursive: true
    });
  }
}

function hashRepositoryWorkingTree(repositoryRoot) {
  const digestMap = hashMaterializedTree(repositoryRoot);
  return Object.fromEntries(
    Object.entries(digestMap).filter(([relativePath]) => !relativePath.startsWith('.oxen'))
  );
}

function runWorkload(workload, repetition, executable) {
  const tempRoot = mkdtempSync(join(tmpdir(), `cdngine-oxen-suite-${workload.id}-${repetition}-`));
  const repositoryRoot = join(tempRoot, 'repo');
  const configDirectory = join(tempRoot, 'config');
  const baseDirectory = join(tempRoot, 'base');
  const duplicateDirectory = join(tempRoot, 'duplicate');
  const patchDirectory = join(tempRoot, 'patch');

  try {
    mkdirSync(repositoryRoot, { recursive: true });
    mkdirSync(configDirectory, { recursive: true });
    mkdirSync(baseDirectory, { recursive: true });
    mkdirSync(duplicateDirectory, { recursive: true });
    mkdirSync(patchDirectory, { recursive: true });
    const base = materializeBenchmarkVersion(baseDirectory, workload.versions.base);
    const duplicate = materializeBenchmarkVersion(duplicateDirectory, workload.versions.duplicate);
    const patch = materializeBenchmarkVersion(patchDirectory, workload.versions.patch);

    runOxen(executable, ['config', '--name', 'CDNgine Bench', '--email', 'bench@example.com'], repositoryRoot, configDirectory);
    runOxen(executable, ['init', repositoryRoot], repositoryRoot, configDirectory);

    syncVersionIntoRepository(repositoryRoot, baseDirectory);
    const baseStartedAt = performance.now();
    runOxen(executable, ['add', '.'], repositoryRoot, configDirectory);
    const baseCommitId = parseCommitId(
      runOxen(executable, ['commit', '-m', `${workload.id}-base-${repetition}`], repositoryRoot, configDirectory)
    );
    const baseDurationMs = performance.now() - baseStartedAt;
    const afterBaseBytes = getDirectorySize(join(repositoryRoot, '.oxen'));

    syncVersionIntoRepository(repositoryRoot, duplicateDirectory);
    const duplicateStartedAt = performance.now();
    runOxen(executable, ['add', '.'], repositoryRoot, configDirectory);
    const duplicateCommitId = parseCommitId(
      runOxen(
        executable,
        ['commit', '--allow-empty', '-m', `${workload.id}-duplicate-${repetition}`],
        repositoryRoot,
        configDirectory
      )
    );
    const duplicateDurationMs = performance.now() - duplicateStartedAt;
    const afterDuplicateBytes = getDirectorySize(join(repositoryRoot, '.oxen'));

    syncVersionIntoRepository(repositoryRoot, patchDirectory);
    const patchStartedAt = performance.now();
    runOxen(executable, ['add', '.'], repositoryRoot, configDirectory);
    const patchCommitId = parseCommitId(
      runOxen(executable, ['commit', '-m', `${workload.id}-patch-${repetition}`], repositoryRoot, configDirectory)
    );
    const patchDurationMs = performance.now() - patchStartedAt;
    const afterPatchBytes = getDirectorySize(join(repositoryRoot, '.oxen'));

    clearRepositoryWorkingTree(repositoryRoot);
    const restoreStartedAt = performance.now();
    for (const file of workload.versions.patch) {
      runOxen(executable, ['restore', file.relativePath, '--source', patchCommitId], repositoryRoot, configDirectory);
    }
    const restoreDurationMs = performance.now() - restoreStartedAt;

    return {
      base: {
        fileCount: base.fileCount,
        logicalByteLength: base.logicalByteLength,
        storedByteLength: afterBaseBytes,
        durationMs: baseDurationMs
      },
      duplicate: {
        fileCount: duplicate.fileCount,
        logicalByteLength: duplicate.logicalByteLength,
        storedByteLength: afterDuplicateBytes - afterBaseBytes,
        durationMs: duplicateDurationMs,
        commitId: duplicateCommitId
      },
      patch: {
        fileCount: patch.fileCount,
        logicalByteLength: patch.logicalByteLength,
        storedByteLength: afterPatchBytes - afterDuplicateBytes,
        durationMs: patchDurationMs,
        commitId: patchCommitId,
        baseCommitId
      },
      restore: {
        fileCount: patch.fileCount,
        logicalByteLength: patch.logicalByteLength,
        durationMs: restoreDurationMs,
        verified:
          JSON.stringify(hashRepositoryWorkingTree(repositoryRoot)) ===
          JSON.stringify(hashMaterializedTree(patchDirectory))
      }
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const executable = resolveOxenExecutable();
const repetitions = getRepetitions();
const workloads = listBenchmarkWorkloads();

process.stdout.write(
  JSON.stringify(
    {
      engine: 'oxen',
      category: 'dataset vcs',
      metricMode:
        'repository growth inside .oxen, which includes versioned file bytes plus commit and Merkle metadata because Oxen does not expose a chunk-level near-duplicate metric surface in the same way as the source-repository candidates.',
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
