/**
 * Purpose: Verifies the production-oriented Xet source adapter preserves engine-neutral evidence while keeping snapshot and materialization behind a controlled bridge.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/upstream-integration-model.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/service-architecture.md
 * External references:
 * - https://huggingface.co/docs/xet/index
 * - https://huggingface.co/docs/xet/en/upload-protocol
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * - https://huggingface.co/docs/xet/en/api
 * - https://github.com/huggingface/xet-core
 * Tests:
 * - packages/storage/test/xet-source-repository.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandBackedXetFileMaterializer,
  CommandBackedXetSnapshotEvidenceProvider,
  InMemoryXetSnapshotStore,
  XetSourceRepository,
  createXetSnapshotResult
} from '../src/xet-source-repository.ts';

class FakeRunner {
  readonly invocations: Array<{ args: string[]; command: string; stdin?: string }> = [];
  private readonly outputs: string[];

  constructor(outputs: string[]) {
    this.outputs = outputs;
  }

  async run(execution: { args: string[]; command: string; stdin?: string }) {
    this.invocations.push({
      command: execution.command,
      args: execution.args,
      stdin: execution.stdin
    });

    return {
      exitCode: 0,
      stdout: this.outputs.shift() ?? '{}',
      stderr: ''
    };
  }
}

test('createXetSnapshotResult maps Xet reconstruction evidence into engine-neutral source evidence', () => {
  const snapshot = createXetSnapshotResult(
    {
      assetVersionId: 'ver_001',
      localPath: 'C:\\staging\\source.bin',
      sourceFilename: 'source.bin',
      logicalByteLength: 4096n,
      sourceDigests: [
        {
          algorithm: 'sha256',
          value: 'sha256-source'
        }
      ]
    },
    {
      fileId: 'file_abc',
      terms: [
        {
          xorbHash: 'xorb_a',
          startChunkIndex: 0,
          endChunkIndex: 4
        },
        {
          xorbHash: 'xorb_b',
          startChunkIndex: 8,
          endChunkIndex: 12
        }
      ],
      shardIds: ['shard_001'],
      uploadedXorbHashes: ['xorb_a'],
      deduplicatedXorbHashes: ['xorb_b'],
      storedByteLength: 2048n,
      chunkCount: 8,
      reusedChunkCount: 4,
      fetchEndpoint: 'https://cas.example.test/v1/reconstructions/file_abc'
    }
  );

  assert.equal(snapshot.repositoryEngine, 'xet');
  assert.equal(snapshot.canonicalSourceId, 'file_abc');
  assert.equal(snapshot.snapshotId, 'file_abc');
  assert.equal(snapshot.storedByteLength, 2048n);
  assert.equal(snapshot.reconstructionHandles?.[0]?.kind, 'manifest');
  assert.equal(snapshot.reconstructionHandles?.[0]?.value, 'file_abc');
  assert.deepEqual(snapshot.reconstructionHandles?.[1], {
    kind: 'chunk-index',
    value: 'shard_001'
  });
  assert.deepEqual(snapshot.dedupeMetrics, {
    chunkCount: 8,
    dedupeRatio: 0.5,
    reusedChunkCount: 4,
    savingsRatio: 0.5,
    storedByteLength: 2048n
  });
  assert.equal(snapshot.substrateHints?.termCount, '2');
  assert.equal(snapshot.substrateHints?.uploadedXorbCount, '1');
  assert.equal(snapshot.substrateHints?.deduplicatedXorbCount, '1');
});

test('CommandBackedXetSnapshotEvidenceProvider sends canonicalization input through stdin and parses Xet-shaped evidence', async () => {
  const runner = new FakeRunner([
    JSON.stringify({
      fileId: 'file_xyz',
      logicalPath: 'models/checkpoint.bin',
      shardIds: ['shard_123'],
      uploadedXorbHashes: ['xorb_new'],
      deduplicatedXorbHashes: ['xorb_cached'],
      logicalByteLength: '8192',
      storedByteLength: '4096',
      chunkCount: 12,
      reusedChunkCount: 9,
      terms: [
        {
          xorbHash: 'xorb_new',
          startChunkIndex: 0,
          endChunkIndex: 6
        },
        {
          xorbHash: 'xorb_cached',
          startChunkIndex: 6,
          endChunkIndex: 12
        }
      ]
    })
  ]);

  const provider = new CommandBackedXetSnapshotEvidenceProvider({
    runner,
    command: 'node',
    args: ['scripts/xet-benchmark.js']
  });

  const evidence = await provider.captureSnapshot({
    assetVersionId: 'ver_002',
    localPath: 'C:\\bench\\checkpoint.bin',
    sourceFilename: 'checkpoint.bin',
    logicalByteLength: 8192n,
    sourceDigests: [
      {
        algorithm: 'sha256',
        value: 'digest-002'
      }
    ],
    metadata: {
      serviceNamespaceId: 'ml-platform'
    }
  });

  assert.equal(evidence.fileId, 'file_xyz');
  assert.equal(evidence.logicalByteLength, 8192n);
  assert.equal(evidence.storedByteLength, 4096n);
  assert.equal(evidence.reusedChunkCount, 9);
  assert.deepEqual(evidence.shardIds, ['shard_123']);
  assert.equal(runner.invocations[0]?.command, 'node');
  assert.deepEqual(runner.invocations[0]?.args, ['scripts/xet-benchmark.js']);

  const parsedRequest = JSON.parse(runner.invocations[0]?.stdin ?? '{}') as {
    assetVersionId?: string;
    logicalByteLength?: string;
    metadata?: Record<string, string>;
  };
  assert.equal(parsedRequest.assetVersionId, 'ver_002');
  assert.equal(parsedRequest.logicalByteLength, '8192');
  assert.equal(parsedRequest.metadata?.serviceNamespaceId, 'ml-platform');
});

test('XetSourceRepository persists snapshot evidence and restores through a controlled materializer', async () => {
  const evidenceRunner = new FakeRunner([
    JSON.stringify({
      fileId: 'file_restore',
      terms: [
        {
          xorbHash: 'xorb_restore',
          startChunkIndex: 0,
          endChunkIndex: 3
        }
      ],
      shardIds: ['shard_restore'],
      logicalByteLength: '3072',
      storedByteLength: '1536',
      chunkCount: 3,
      reusedChunkCount: 1
    })
  ]);
  const materializeRunner = new FakeRunner(['{}']);
  const repository = new XetSourceRepository({
    evidenceProvider: new CommandBackedXetSnapshotEvidenceProvider({
      runner: evidenceRunner,
      command: 'node',
      args: ['scripts/xet-benchmark.js']
    }),
    snapshotStore: new InMemoryXetSnapshotStore(),
    materializer: new CommandBackedXetFileMaterializer({
      runner: materializeRunner,
      command: 'node',
      args: ['scripts/xet-restore.js']
    })
  });

  const snapshot = await repository.snapshotFromPath({
    assetVersionId: 'ver_restore',
    localPath: 'C:\\bench\\restore.bin',
    sourceFilename: 'restore.bin'
  });
  const snapshots = await repository.listSnapshots('ver_restore');
  const restored = await repository.restoreToPath({
    canonicalSourceId: snapshot.canonicalSourceId,
    destinationPath: 'C:\\restore\\out.bin'
  });

  assert.equal(snapshot.repositoryEngine, 'xet');
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.snapshotId, 'file_restore');
  assert.equal(restored.restoredPath, 'C:\\restore\\out.bin');

  const restoreRequest = JSON.parse(materializeRunner.invocations[0]?.stdin ?? '{}') as {
    destinationPath?: string;
    evidence?: { shardIds?: string[] };
    snapshot?: {
      canonicalSourceId?: string;
      reconstructionHandles?: Array<{ kind?: string; value?: string }>;
    };
  };
  assert.equal(restoreRequest.destinationPath, 'C:\\restore\\out.bin');
  assert.equal(restoreRequest.snapshot?.canonicalSourceId, 'file_restore');
  assert.equal(restoreRequest.snapshot?.reconstructionHandles?.[0]?.kind, 'manifest');
  assert.deepEqual(restoreRequest.evidence?.shardIds, ['shard_restore']);
});

test('XetSourceRepository restores from engine-neutral snapshot evidence when no local snapshot record is available', async () => {
  let receivedInput:
    | {
        destinationPath: string;
        evidence?: unknown;
        snapshot: {
          canonicalSourceId: string;
          reconstructionHandles?: Array<{ kind: string; value: string }>;
          substrateHints?: Record<string, string>;
        };
      }
    | undefined;

  const repository = new XetSourceRepository({
    evidenceProvider: {
      async captureSnapshot() {
        throw new Error('captureSnapshot should not be called in this test.');
      }
    },
    snapshotStore: new InMemoryXetSnapshotStore(),
    materializer: {
      async materializeFile(input) {
        receivedInput = input;
      }
    }
  });

  const snapshot = createXetSnapshotResult(
    {
      assetVersionId: 'ver_registry_only',
      localPath: 'C:\\staging\\registry-only.bin',
      sourceFilename: 'registry-only.bin'
    },
    {
      fileId: 'file_registry_only',
      terms: [
        {
          xorbHash: 'xorb_registry_only',
          startChunkIndex: 0,
          endChunkIndex: 2
        }
      ],
      shardIds: ['shard_registry_only'],
      fetchEndpoint: 'https://cas.example.test/v1/reconstructions/file_registry_only'
    }
  );

  const restored = await repository.restoreToPath({
    canonicalSourceId: snapshot.canonicalSourceId,
    destinationPath: 'C:\\restore\\registry-only.bin',
    snapshot
  });

  assert.equal(restored.restoredPath, 'C:\\restore\\registry-only.bin');
  assert.equal(receivedInput?.snapshot.canonicalSourceId, 'file_registry_only');
  assert.equal(receivedInput?.snapshot.reconstructionHandles?.[0]?.value, 'file_registry_only');
  assert.equal(
    receivedInput?.snapshot.substrateHints?.fetchEndpoint,
    'https://cas.example.test/v1/reconstructions/file_registry_only'
  );
  assert.equal(receivedInput?.evidence, undefined);
});

test('XetSourceRepository keeps near-duplicate byte-reuse proof attached to the captured asset version', async () => {
  const evidenceRunner = new FakeRunner([
    JSON.stringify({
      fileId: 'xet_file_checkpoint_patch',
      terms: [
        {
          xorbHash: 'xorb_base_001',
          startChunkIndex: 0,
          endChunkIndex: 6
        },
        {
          xorbHash: 'xorb_base_002',
          startChunkIndex: 6,
          endChunkIndex: 12
        },
        {
          xorbHash: 'xorb_patch_003',
          startChunkIndex: 12,
          endChunkIndex: 16
        }
      ],
      shardIds: ['shard_checkpoint_patch'],
      uploadedXorbHashes: ['xorb_patch_003'],
      deduplicatedXorbHashes: ['xorb_base_001', 'xorb_base_002'],
      logicalPath: 'models/checkpoint-v2.bin',
      logicalByteLength: '8388608',
      storedByteLength: '1048576',
      chunkCount: 16,
      reusedChunkCount: 14
    })
  ]);
  const materializeRunner = new FakeRunner(['{}']);
  const repository = new XetSourceRepository({
    evidenceProvider: new CommandBackedXetSnapshotEvidenceProvider({
      runner: evidenceRunner,
      command: 'node',
      args: ['scripts/xet-benchmark.js']
    }),
    snapshotStore: new InMemoryXetSnapshotStore(),
    materializer: new CommandBackedXetFileMaterializer({
      runner: materializeRunner,
      command: 'node',
      args: ['scripts/xet-restore.js']
    })
  });

  const snapshot = await repository.snapshotFromPath({
    assetVersionId: 'ver_checkpoint_patch',
    localPath: 'C:\\bench\\checkpoint-v2.bin',
    sourceFilename: 'checkpoint-v2.bin',
    logicalByteLength: 8388608n,
    sourceDigests: [
      {
        algorithm: 'sha256',
        value: 'checkpoint-v2-sha256'
      }
    ]
  });
  const listed = await repository.listSnapshots('ver_checkpoint_patch');
  const restored = await repository.restoreToPath({
    canonicalSourceId: snapshot.canonicalSourceId,
    destinationPath: 'C:\\restore\\checkpoint-v2.bin'
  });

  assert.equal(snapshot.repositoryEngine, 'xet');
  assert.equal(snapshot.canonicalSourceId, 'xet_file_checkpoint_patch');
  assert.notEqual(snapshot.canonicalSourceId, 'ver_checkpoint_patch');
  assert.deepEqual(snapshot.dedupeMetrics, {
    chunkCount: 16,
    dedupeRatio: 0.875,
    reusedChunkCount: 14,
    savingsRatio: 0.875,
    storedByteLength: 1048576n
  });
  assert.deepEqual(listed, [
    {
      canonicalSourceId: 'xet_file_checkpoint_patch',
      snapshotId: 'xet_file_checkpoint_patch',
      createdAt: listed[0]?.createdAt
    }
  ]);
  assert.equal(restored.restoredPath, 'C:\\restore\\checkpoint-v2.bin');

  const restoreRequest = JSON.parse(materializeRunner.invocations[0]?.stdin ?? '{}') as {
    evidence?: {
      deduplicatedXorbHashes?: string[];
      uploadedXorbHashes?: string[];
      storedByteLength?: string;
    };
    snapshot?: {
      reconstructionHandles?: Array<{ kind?: string; value?: string }>;
    };
  };
  assert.equal(restoreRequest.snapshot?.reconstructionHandles?.[0]?.value, 'xet_file_checkpoint_patch');
  assert.deepEqual(restoreRequest.evidence?.uploadedXorbHashes, ['xorb_patch_003']);
  assert.deepEqual(restoreRequest.evidence?.deduplicatedXorbHashes, [
    'xorb_base_001',
    'xorb_base_002'
  ]);
  assert.equal(restoreRequest.evidence?.storedByteLength, '1048576');
});
