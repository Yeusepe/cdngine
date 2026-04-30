/**
 * Purpose: Verifies that deployment-time environment variables resolve into one stable logical storage-role model for one-bucket and multi-bucket profiles.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/original-source-delivery.md
 * Tests:
 * - packages/storage/test/runtime-storage-config.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StorageRuntimeConfigError,
  loadStorageRuntimeConfigFromEnvironment
} from '../dist/runtime-storage-config.js';
import * as storagePackage from '../dist/index.js';

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

test('loadStorageRuntimeConfigFromEnvironment resolves one-bucket profiles into distinct logical targets', () => {
  const config = loadStorageRuntimeConfigFromEnvironment({
    CDNGINE_DERIVED_PREFIX: 'published',
    CDNGINE_HOT_READ_LAYER: 'nydus',
    CDNGINE_XET_COMMAND: 'xet',
    CDNGINE_SOURCE_DELIVERY_MODE: 'materialized-export',
    CDNGINE_STORAGE_BUCKET: 'cdngine-data',
    CDNGINE_STORAGE_LAYOUT_MODE: 'one-bucket',
    CDNGINE_TIERING_SUBSTRATE: 'seaweedfs'
  });

  assert.equal(config.layout.mode, 'one-bucket');
  assert.equal(config.normalized.ingest.targetKey, 'cdngine-data/ingest');
  assert.equal(config.normalized.derived.targetKey, 'cdngine-data/published');
  assert.deepEqual(config.defaults, {
    hotReadLayer: 'nydus',
    sourceDeliveryMode: 'materialized-export',
    tieringSubstrate: 'seaweedfs'
  });
  assert.equal(config.sourceRepository.engine, 'xet');
});

test('loadStorageRuntimeConfigFromEnvironment resolves multi-bucket profiles with explicit buckets', () => {
  const config = loadStorageRuntimeConfigFromEnvironment({
    CDNGINE_DERIVED_BUCKET: 'cdngine-derived',
    CDNGINE_EXPORTS_BUCKET: 'cdngine-exports',
    CDNGINE_INGEST_BUCKET: 'cdngine-ingest',
    CDNGINE_KOPIA_EXECUTABLE: 'kopia',
    CDNGINE_SOURCE_BUCKET: 'cdngine-source',
    CDNGINE_SOURCE_ENGINE: 'kopia',
    CDNGINE_STORAGE_LAYOUT_MODE: 'multi-bucket'
  });

  assert.equal(config.layout.mode, 'multi-bucket');
  assert.equal(config.normalized.source.targetKey, 'cdngine-source/source');
  assert.equal(config.normalized.exports.targetKey, 'cdngine-exports/exports');
  assert.deepEqual(config.defaults, {
    hotReadLayer: 'none',
    sourceDeliveryMode: 'proxy',
    tieringSubstrate: 'rustfs'
  });
  assert.equal(config.sourceRepository.engine, 'kopia');
});

test('loadStorageRuntimeConfigFromEnvironment rejects missing required bucket values', () => {
  assert.throws(
    () =>
      loadStorageRuntimeConfigFromEnvironment({
        CDNGINE_XET_COMMAND: 'xet',
        CDNGINE_STORAGE_LAYOUT_MODE: 'multi-bucket'
      }),
    StorageRuntimeConfigError
  );
});

test('storage package entrypoint exports source repository runtime loader and factory surfaces', () => {
  assert.equal(typeof storagePackage.createSourceRepositoryFromEnvironment, 'function');
  assert.equal(typeof storagePackage.createSourceRepository, 'function');
  assert.equal(typeof storagePackage.loadSourceRepositoryRuntimeConfigFromEnvironment, 'function');
  assert.equal(typeof storagePackage.resolveSourceRepositoryEngineFromEnvironment, 'function');
});

test('resolveSourceRepositoryEngineFromEnvironment defaults to xet when the engine variable is absent', () => {
  assert.equal(storagePackage.resolveSourceRepositoryEngineFromEnvironment({}), 'xet');
});

test('createSourceRepositoryFromEnvironment uses Xet by default when the engine variable is absent', async () => {
  const repository = storagePackage.createSourceRepositoryFromEnvironment({
    environment: {
      CDNGINE_XET_COMMAND: 'xet-cli'
    },
    xet: {
      evidenceProvider: {
        async captureSnapshot() {
          return {
            fileId: 'xet-file-001',
            logicalPath: 'original.bin',
            terms: [
              {
                xorbHash: 'xorb-001',
                startChunkIndex: 0,
                endChunkIndex: 4
              }
            ]
          };
        }
      },
      materializer: {
        async materializeFile() {}
      },
      snapshotStore: new storagePackage.InMemoryXetSnapshotStore()
    }
  });

  const snapshot = await repository.snapshotFromPath({
    assetVersionId: 'ver_xet_001',
    localPath: 'C:\\staging\\original.bin',
    sourceFilename: 'original.bin'
  });

  assert.equal(snapshot.repositoryEngine, 'xet');
});

test('createSourceRepositoryFromEnvironment preserves explicit kopia compatibility during migration', async () => {
  const runner = new FakeRunner([
    JSON.stringify({
      id: 'snap-001',
      source: {
        path: 'C:\\staging\\legacy.bin'
      }
    })
  ]);

  const repository = storagePackage.createSourceRepositoryFromEnvironment({
    environment: {
      CDNGINE_SOURCE_ENGINE: 'kopia'
    },
    runner
  });

  const snapshot = await repository.snapshotFromPath({
    assetVersionId: 'ver_kopia_001',
    localPath: 'C:\\staging\\legacy.bin',
    sourceFilename: 'legacy.bin'
  });

  assert.equal(snapshot.repositoryEngine, 'kopia');
  assert.equal(runner.invocations[0]?.command, 'kopia');
});

test('loadSourceRepositoryRuntimeConfigFromEnvironment rejects invalid source engine values clearly', () => {
  assert.throws(
    () =>
      storagePackage.loadSourceRepositoryRuntimeConfigFromEnvironment({
        CDNGINE_SOURCE_ENGINE: 'restic'
      }),
    (error) => {
      assert.ok(error instanceof StorageRuntimeConfigError);
      assert.match(error.message, /CDNGINE_SOURCE_ENGINE must be one of xet, kopia/);
      return true;
    }
  );
});

test('loadSourceRepositoryRuntimeConfigFromEnvironment requires a Xet command or service endpoint', () => {
  assert.throws(
    () =>
      storagePackage.loadSourceRepositoryRuntimeConfigFromEnvironment({
        CDNGINE_SOURCE_ENGINE: 'xet'
      }),
    (error) => {
      assert.ok(error instanceof StorageRuntimeConfigError);
      assert.match(
        error.message,
        /Xet runtime config requires CDNGINE_XET_COMMAND or CDNGINE_XET_SERVICE_ENDPOINT/
      );
      return true;
    }
  );
});

test('loadSourceRepositoryRuntimeConfigFromEnvironment rejects blank explicit Kopia executables', () => {
  assert.throws(
    () =>
      storagePackage.loadSourceRepositoryRuntimeConfigFromEnvironment({
        CDNGINE_SOURCE_ENGINE: 'kopia',
        CDNGINE_KOPIA_EXECUTABLE: '   '
      }),
    (error) => {
      assert.ok(error instanceof StorageRuntimeConfigError);
      assert.match(error.message, /CDNGINE_KOPIA_EXECUTABLE cannot be empty when provided/);
      return true;
    }
  );
});

test('createSourceRepositoryFromEnvironment supports service-backed Xet wiring for production runtime selection', async () => {
  const fetchInvocations = [];
  const repository = storagePackage.createSourceRepositoryFromEnvironment({
    environment: {
      CDNGINE_XET_SERVICE_ENDPOINT: 'https://xet.service.internal',
      CDNGINE_XET_TIMEOUT_MS: '5000'
    },
    xet: {
      fetch: async (input, init) => {
        fetchInvocations.push({
          input: String(input),
          body: JSON.parse(String(init?.body ?? '{}'))
        });
        return new Response(
          JSON.stringify({
            fileId: 'xet-service-file-001',
            terms: [
              {
                xorbHash: 'xorb-service-001',
                startChunkIndex: 0,
                endChunkIndex: 4
              }
            ],
            shardIds: ['shard-service-001']
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      },
      snapshotStore: new storagePackage.InMemoryXetSnapshotStore()
    }
  });

  const snapshot = await repository.snapshotFromPath({
    assetVersionId: 'ver_xet_service_001',
    localPath: 'C:\\staging\\service-source.bin',
    sourceFilename: 'service-source.bin'
  });

  assert.equal(snapshot.repositoryEngine, 'xet');
  assert.equal(fetchInvocations[0]?.input, 'https://xet.service.internal/v1/snapshots');
  assert.equal(fetchInvocations[0]?.body.assetVersionId, 'ver_xet_service_001');
});

test('createSourceRepositoryFromEnvironment restores legacy Kopia snapshots and Xet snapshots through one runtime-selected repository', async () => {
  const runner = new FakeRunner(['{}']);
  const xetMaterializations = [];
  const repository = storagePackage.createSourceRepositoryFromEnvironment({
    environment: {
      CDNGINE_XET_COMMAND: 'xet-cli'
    },
    runner,
    xet: {
      evidenceProvider: {
        async captureSnapshot() {
          throw new Error('captureSnapshot should not run in this restore test.');
        }
      },
      materializer: {
        async materializeFile(input) {
          xetMaterializations.push(input);
        }
      },
      snapshotStore: new storagePackage.InMemoryXetSnapshotStore()
    }
  });

  await repository.restoreToPath({
    canonicalSourceId: 'xet_file_001',
    destinationPath: 'C:\\restore\\xet.bin',
    snapshot: {
      repositoryEngine: 'xet',
      canonicalSourceId: 'xet_file_001',
      snapshotId: 'xet_file_001',
      logicalPath: 'source/ml-platform/ver_001/model.bin',
      digests: [],
      reconstructionHandles: [
        {
          kind: 'manifest',
          value: 'xet_file_001'
        }
      ]
    }
  });
  await repository.restoreToPath({
    canonicalSourceId: 'legacy-src-001',
    destinationPath: 'C:\\restore\\legacy.bin',
    snapshot: {
      repositoryEngine: 'kopia',
      canonicalSourceId: 'legacy-src-001',
      snapshotId: 'snap-legacy-001',
      logicalPath: 'source/media-platform/ver_001/legacy.bin',
      digests: [],
      reconstructionHandles: [
        {
          kind: 'snapshot',
          value: 'snap-legacy-001'
        }
      ]
    }
  });

  assert.equal(xetMaterializations[0]?.snapshot.canonicalSourceId, 'xet_file_001');
  assert.equal(runner.invocations[0]?.command, 'kopia');
  assert.deepEqual(runner.invocations[0]?.args.slice(0, 4), [
    'snapshot',
    'restore',
    'legacy-src-001',
    'C:\\restore\\legacy.bin'
  ]);
});
