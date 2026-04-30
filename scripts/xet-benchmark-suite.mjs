/**
 * Purpose: Runs the rigorous multi-workload source-plane benchmark suite through the benchmark-facing Xet-like command boundary and reports repeated size, speed, and restore metrics.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/testing-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * External references:
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * Tests:
 * - scripts/source-plane-benchmark-framework.test.mjs
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

import {
  hashMaterializedTree,
  listBenchmarkWorkloads,
  materializeBenchmarkVersion,
  summarizeWorkloadRuns
} from './source-plane-benchmark-framework.mjs';

function runJson(command, args, env, input) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command} ${args.join(' ')}`);
  }

  return JSON.parse(result.stdout);
}

function getRepetitions() {
  const value = Number(process.env.CDNGINE_SOURCE_BENCHMARK_REPETITIONS ?? '3');

  return Number.isInteger(value) && value > 0 ? value : 3;
}

const command = process.execPath;
const benchmarkScript = resolve('scripts', 'xet-benchmark.js');
const restoreScript = resolve('scripts', 'xet-restore.js');
const repetitions = getRepetitions();
const workloads = listBenchmarkWorkloads();

function runStage(repositoryDirectory, stageDirectory, files, stageIdPrefix) {
  const env = { CDNGINE_XET_REPO_DIR: repositoryDirectory };
  const startedAt = performance.now();
  let storedByteLength = 0;
  const evidence = [];

  for (const [index, file] of files.entries()) {
    const localPath = join(stageDirectory, file.relativePath);
    const result = runJson(
      command,
      [benchmarkScript],
      env,
      JSON.stringify({
        assetVersionId: `${stageIdPrefix}-${index}`,
        localPath,
        sourceFilename: file.relativePath,
        metadata: {
          logicalPath: file.relativePath
        }
      })
    );
    storedByteLength += Number(result.storedByteLength);
    evidence.push({ file, result });
  }

  const durationMs = performance.now() - startedAt;
  const { fileCount, logicalByteLength } = materializeBenchmarkVersion(stageDirectory, files);

  return {
    fileCount,
    logicalByteLength,
    storedByteLength,
    durationMs,
    evidence
  };
}

function runRestore(repositoryDirectory, restoreDirectory, stage) {
  const env = { CDNGINE_XET_REPO_DIR: repositoryDirectory };
  mkdirSync(restoreDirectory, { recursive: true });
  const startedAt = performance.now();

  for (const entry of stage.evidence) {
    runJson(
      command,
      [restoreScript],
      env,
      JSON.stringify({
        fileId: entry.result.fileId,
        destinationPath: join(restoreDirectory, entry.file.relativePath),
        evidence: entry.result
      })
    );
  }

  return {
    fileCount: stage.fileCount,
    logicalByteLength: stage.logicalByteLength,
    durationMs: performance.now() - startedAt,
    verified: JSON.stringify(hashMaterializedTree(restoreDirectory)) === JSON.stringify(hashMaterializedTree(join(restoreDirectory, '..', 'patch')))
  };
}

function runWorkload(workload, repetition) {
  const workspace = mkdtempSync(join(tmpdir(), `cdngine-xet-suite-${workload.id}-${repetition}-`));
  const repositoryDirectory = join(workspace, 'repo');
  const baseDirectory = join(workspace, 'base');
  const duplicateDirectory = join(workspace, 'duplicate');
  const patchDirectory = join(workspace, 'patch');
  const restoreDirectory = join(workspace, 'restore');

  try {
    mkdirSync(repositoryDirectory, { recursive: true });
    materializeBenchmarkVersion(baseDirectory, workload.versions.base);
    materializeBenchmarkVersion(duplicateDirectory, workload.versions.duplicate);
    materializeBenchmarkVersion(patchDirectory, workload.versions.patch);

    const base = runStage(repositoryDirectory, baseDirectory, workload.versions.base, `${workload.id}-base-${repetition}`);
    const duplicate = runStage(
      repositoryDirectory,
      duplicateDirectory,
      workload.versions.duplicate,
      `${workload.id}-duplicate-${repetition}`
    );
    const patch = runStage(repositoryDirectory, patchDirectory, workload.versions.patch, `${workload.id}-patch-${repetition}`);
    const restore = runRestore(repositoryDirectory, restoreDirectory, patch);

    restore.verified =
      JSON.stringify(hashMaterializedTree(restoreDirectory)) === JSON.stringify(hashMaterializedTree(patchDirectory));

    return {
      base: {
        fileCount: base.fileCount,
        logicalByteLength: base.logicalByteLength,
        storedByteLength: base.storedByteLength,
        durationMs: base.durationMs
      },
      duplicate: {
        fileCount: duplicate.fileCount,
        logicalByteLength: duplicate.logicalByteLength,
        storedByteLength: duplicate.storedByteLength,
        durationMs: duplicate.durationMs
      },
      patch: {
        fileCount: patch.fileCount,
        logicalByteLength: patch.logicalByteLength,
        storedByteLength: patch.storedByteLength,
        durationMs: patch.durationMs
      },
      restore
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

process.stdout.write(
  JSON.stringify(
    {
      engine: 'xet',
      category: 'near-duplicate chunk store',
      metricMode: 'native stored bytes reported by the benchmark-facing Xet reconstruction evidence',
      repetitions,
      workloads: workloads.map((workload) => {
        const runs = Array.from({ length: repetitions }, (_, repetition) => runWorkload(workload, repetition + 1));

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
