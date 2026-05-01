/**
 * Purpose: Verifies worker-side source materialization restores both default Xet-backed versions and legacy Kopia-backed versions through one runtime-selected repository.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/testing-strategy.md
 * Tests:
 * - apps/workers/test/source-materialization.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

import {
  WorkerSourceMaterializer,
  createWorkerSourceRepositoryFromEnvironment
} from '../dist/index.js';

class FakeRunner {
  constructor(outputs) {
    this.outputs = [...outputs];
    this.invocations = [];
  }

  async run(execution) {
    this.invocations.push(execution);

    return {
      exitCode: 0,
      stdout: this.outputs.shift() ?? '{}',
      stderr: ''
    };
  }
}

function expectPathSuffix(path, segments) {
  assert.ok(
    normalize(path).endsWith(join(...segments)),
    `expected ${path} to end with ${join(...segments)}`
  );
}

test('WorkerSourceMaterializer restores Xet-backed and legacy Kopia-backed evidence through the runtime-selected source repository', async () => {
  const materializationRootPath = await mkdtemp(join(tmpdir(), 'cdngine-worker-source-'));

  const runner = new FakeRunner(['{}']);
  const xetMaterializations = [];
  const repository = createWorkerSourceRepositoryFromEnvironment({
    environment: {
      CDNGINE_XET_COMMAND: 'xet-cli'
    },
    runner,
    xet: {
      evidenceProvider: {
        async captureSnapshot() {
          throw new Error('captureSnapshot should not run in this test.');
        }
      },
      materializer: {
        async materializeFile(input) {
          xetMaterializations.push(input);
        }
      }
    }
  });
  const materializer = new WorkerSourceMaterializer({
    materializationRootPath,
    sourceRepository: repository
  });

  const xetRestored = await materializer.materializeVersion({
    assetId: 'ast_xet_001',
    canonicalSourceEvidence: {
      repositoryEngine: 'xet',
      canonicalSourceId: 'xet_file_001',
      canonicalSnapshotId: 'xet_file_001',
      canonicalLogicalPath: 'source/ml-platform/ast_xet_001/ver_xet_001/original/model.bin',
      canonicalDigestSet: [],
      sourceReconstructionHandles: [
        {
          kind: 'manifest',
          value: 'xet_file_001'
        }
      ]
    },
    sourceFilename: 'model.bin',
    versionId: 'ver_xet_001'
  });
  const kopiaRestored = await materializer.materializeVersion({
    assetId: 'ast_legacy_001',
    canonicalSourceEvidence: {
      repositoryEngine: 'kopia',
      canonicalSourceId: 'legacy_src_001',
      canonicalSnapshotId: 'snap_legacy_001',
      canonicalLogicalPath: 'source/media-platform/ast_legacy_001/ver_legacy_001/original/legacy.bin',
      canonicalDigestSet: [],
      sourceReconstructionHandles: [
        {
          kind: 'snapshot',
          value: 'snap_legacy_001'
        }
      ]
    },
    sourceFilename: 'legacy.bin',
    versionId: 'ver_legacy_001'
  });

  expectPathSuffix(xetRestored.restoredPath, ['ast_xet_001', 'ver_xet_001', 'model.bin']);
  assert.equal(xetMaterializations[0]?.snapshot.canonicalSourceId, 'xet_file_001');
  expectPathSuffix(kopiaRestored.restoredPath, [
    'ast_legacy_001',
    'ver_legacy_001',
    'legacy.bin'
  ]);
  assert.equal(runner.invocations[0]?.command, 'kopia');
  assert.deepEqual(runner.invocations[0]?.args.slice(0, 4), [
    'snapshot',
    'restore',
    'legacy_src_001',
    kopiaRestored.restoredPath
  ]);

  await rm(materializationRootPath, { force: true, recursive: true, maxRetries: 3 });
});

test('WorkerSourceMaterializer sanitizes persisted source filenames before materializing into the worker root', async () => {
  const materializationRootPath = await mkdtemp(join(tmpdir(), 'cdngine-worker-source-'));

  const restores = [];
  const materializer = new WorkerSourceMaterializer({
    materializationRootPath,
    sourceRepository: {
      async listSnapshots() {
        return [];
      },
      async restoreToPath(input) {
        restores.push(input);
        return {
          restoredPath: input.destinationPath
        };
      },
      async snapshotFromPath() {
        throw new Error('snapshotFromPath should not run in this test.');
      }
    }
  });

  const restored = await materializer.materializeVersion({
    assetId: 'ast_unsafe',
    canonicalSourceEvidence: {
      repositoryEngine: 'kopia',
      canonicalSourceId: 'unsafe_src_001',
      canonicalSnapshotId: 'snap_unsafe_001',
      canonicalLogicalPath:
        'source/media-platform/ast_unsafe/ver_unsafe/original/..\\unsafe\\worker-source.tar',
      canonicalDigestSet: [],
      sourceReconstructionHandles: [
        {
          kind: 'snapshot',
          value: 'snap_unsafe_001'
        }
      ]
    },
    sourceFilename: '..\\..\\unsafe\\worker-source.tar',
    versionId: 'ver_unsafe'
  });

  expectPathSuffix(restores[0]?.destinationPath ?? '', [
    'ast_unsafe',
    'ver_unsafe',
    'worker-source.tar'
  ]);
  assert.equal(restored.restoredPath, restores[0]?.destinationPath);

  await rm(materializationRootPath, { force: true, recursive: true, maxRetries: 3 });
});
