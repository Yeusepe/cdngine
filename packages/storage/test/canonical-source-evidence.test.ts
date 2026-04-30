/**
 * Purpose: Verifies that engine-neutral canonical-source evidence can be serialized for registry persistence and reconstructed without losing byte-level facts.
 * Governing docs:
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/source-plane-strategy.md
 * - docs/persistence-model.md
 * External references:
 * - https://kopia.io/docs/features/
 * - https://huggingface.co/docs/xet/en/deduplication
 * Tests:
 * - packages/storage/test/canonical-source-evidence.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalSourceEvidenceToSnapshotResult,
  snapshotResultToCanonicalSourceEvidence
} from '../src/canonical-source-evidence.ts';

test('canonical-source evidence round-trips snapshot facts through registry persistence shape', () => {
  const evidence = snapshotResultToCanonicalSourceEvidence({
    repositoryEngine: 'kopia',
    canonicalSourceId: 'src_001',
    snapshotId: 'snap_001',
    logicalPath: 'source/media-platform/ast_001/ver_001/original',
    digests: [
      {
        algorithm: 'sha256',
        value: 'abc123'
      }
    ],
    logicalByteLength: 4096n,
    storedByteLength: 2048n,
    dedupeMetrics: {
      chunkCount: 12,
      dedupeRatio: 2,
      reusedChunkCount: 8,
      savingsRatio: 0.5,
      storedByteLength: 2048n
    },
    reconstructionHandles: [
      {
        kind: 'snapshot',
        value: 'snap_001'
      },
      {
        kind: 'merkle-root',
        value: 'tree_001'
      }
    ],
    substrateHints: {
      bucket: 'cdngine-source',
      prefix: 'source/media-platform'
    }
  });

  assert.deepEqual(evidence, {
    repositoryEngine: 'kopia',
    canonicalSourceId: 'src_001',
    canonicalSnapshotId: 'snap_001',
    canonicalLogicalPath: 'source/media-platform/ast_001/ver_001/original',
    canonicalDigestSet: [
      {
        algorithm: 'sha256',
        value: 'abc123'
      }
    ],
    canonicalLogicalByteLength: 4096n,
    canonicalStoredByteLength: 2048n,
    dedupeMetrics: {
      chunkCount: 12,
      dedupeRatio: 2,
      reusedChunkCount: 8,
      savingsRatio: 0.5,
      storedByteLength: 2048n
    },
    sourceReconstructionHandles: [
      {
        kind: 'snapshot',
        value: 'snap_001'
      },
      {
        kind: 'merkle-root',
        value: 'tree_001'
      }
    ],
    sourceSubstrateHints: {
      bucket: 'cdngine-source',
      prefix: 'source/media-platform'
    }
  });

  assert.deepEqual(canonicalSourceEvidenceToSnapshotResult(evidence), {
    repositoryEngine: 'kopia',
    canonicalSourceId: 'src_001',
    snapshotId: 'snap_001',
    logicalPath: 'source/media-platform/ast_001/ver_001/original',
    digests: [
      {
        algorithm: 'sha256',
        value: 'abc123'
      }
    ],
    logicalByteLength: 4096n,
    storedByteLength: 2048n,
    dedupeMetrics: {
      chunkCount: 12,
      dedupeRatio: 2,
      reusedChunkCount: 8,
      savingsRatio: 0.5,
      storedByteLength: 2048n
    },
    reconstructionHandles: [
      {
        kind: 'snapshot',
        value: 'snap_001'
      },
      {
        kind: 'merkle-root',
        value: 'tree_001'
      }
    ],
    substrateHints: {
      bucket: 'cdngine-source',
      prefix: 'source/media-platform'
    }
  });
});

test('canonical-source evidence round-trips Xet reconstruction facts without losing engine-specific restore metadata', () => {
  const evidence = snapshotResultToCanonicalSourceEvidence({
    repositoryEngine: 'xet',
    canonicalSourceId: 'file_abc',
    snapshotId: 'file_abc',
    logicalPath: 'models/checkpoint.bin',
    digests: [
      {
        algorithm: 'sha256',
        value: 'sha256-source'
      }
    ],
    logicalByteLength: 8192n,
    storedByteLength: 4096n,
    dedupeMetrics: {
      chunkCount: 12,
      dedupeRatio: 0.75,
      reusedChunkCount: 9,
      savingsRatio: 0.75,
      storedByteLength: 4096n
    },
    reconstructionHandles: [
      {
        kind: 'manifest',
        value: 'file_abc'
      },
      {
        kind: 'chunk-index',
        value: 'shard_123'
      }
    ],
    substrateHints: {
      deduplicatedXorbCount: '1',
      fetchEndpoint: 'https://cas.example.test/v1/reconstructions/file_abc',
      manifestKind: 'xet-file-reconstruction',
      termCount: '2',
      uploadedXorbCount: '1'
    }
  });

  assert.deepEqual(canonicalSourceEvidenceToSnapshotResult(evidence), {
    repositoryEngine: 'xet',
    canonicalSourceId: 'file_abc',
    snapshotId: 'file_abc',
    logicalPath: 'models/checkpoint.bin',
    digests: [
      {
        algorithm: 'sha256',
        value: 'sha256-source'
      }
    ],
    logicalByteLength: 8192n,
    storedByteLength: 4096n,
    dedupeMetrics: {
      chunkCount: 12,
      dedupeRatio: 0.75,
      reusedChunkCount: 9,
      savingsRatio: 0.75,
      storedByteLength: 4096n
    },
    reconstructionHandles: [
      {
        kind: 'manifest',
        value: 'file_abc'
      },
      {
        kind: 'chunk-index',
        value: 'shard_123'
      }
    ],
    substrateHints: {
      deduplicatedXorbCount: '1',
      fetchEndpoint: 'https://cas.example.test/v1/reconstructions/file_abc',
      manifestKind: 'xet-file-reconstruction',
      termCount: '2',
      uploadedXorbCount: '1'
    }
  });
});

test('canonical-source evidence keeps backend-agnostic replay fixtures stable across persistence boundaries', () => {
  const fixtures = [
    {
      repositoryEngine: 'kopia',
      canonicalSourceId: 'src_marketing_deck_v7',
      snapshotId: 'snap_marketing_deck_v7',
      logicalPath: 'source/media-platform/ast_042/ver_007/original/event-deck-v7.pdf',
      digests: [
        {
          algorithm: 'sha256',
          value: 'deck-v7-sha256'
        }
      ],
      logicalByteLength: 50331648n,
      storedByteLength: 25165824n,
      dedupeMetrics: {
        chunkCount: 96,
        dedupeRatio: 0.5,
        reusedChunkCount: 48,
        savingsRatio: 0.5,
        storedByteLength: 25165824n
      },
      reconstructionHandles: [
        {
          kind: 'snapshot',
          value: 'snap_marketing_deck_v7'
        },
        {
          kind: 'merkle-root',
          value: 'tree_marketing_deck_v7'
        }
      ],
      substrateHints: {
        bucket: 'cdngine-source',
        prefix: 'source/media-platform',
        repositoryTool: 'kopia'
      }
    },
    {
      repositoryEngine: 'xet',
      canonicalSourceId: 'xet_file_checkpoint_patch',
      snapshotId: 'xet_file_checkpoint_patch',
      logicalPath: 'source/ml-platform/ast_314/ver_002/original/checkpoint-v2.bin',
      digests: [
        {
          algorithm: 'sha256',
          value: 'checkpoint-v2-sha256'
        }
      ],
      logicalByteLength: 8388608n,
      storedByteLength: 1048576n,
      dedupeMetrics: {
        chunkCount: 16,
        dedupeRatio: 0.875,
        reusedChunkCount: 14,
        savingsRatio: 0.875,
        storedByteLength: 1048576n
      },
      reconstructionHandles: [
        {
          kind: 'manifest',
          value: 'xet_file_checkpoint_patch'
        },
        {
          kind: 'chunk-index',
          value: 'shard_checkpoint_patch'
        }
      ],
      substrateHints: {
        deduplicatedXorbCount: '5',
        fetchEndpoint: 'https://cas.example.test/v1/reconstructions/xet_file_checkpoint_patch',
        manifestKind: 'xet-file-reconstruction',
        termCount: '6',
        uploadedXorbCount: '1'
      }
    }
  ] as const;

  for (const fixture of fixtures) {
    const persisted = snapshotResultToCanonicalSourceEvidence(fixture);
    const reconstructed = canonicalSourceEvidenceToSnapshotResult(persisted);

    assert.deepEqual(reconstructed, fixture);

    reconstructed.digests[0].value = 'mutated-digest';
    reconstructed.reconstructionHandles?.splice(0, 1);
    reconstructed.substrateHints = {
      mutated: 'true'
    };

    assert.deepEqual(canonicalSourceEvidenceToSnapshotResult(persisted), fixture);
  }
});
