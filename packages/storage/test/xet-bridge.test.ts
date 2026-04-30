/**
 * Purpose: Verifies that production Xet command and service bridges fail loudly, honor timeouts, and validate bridge configuration before request-path wiring consumes them.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/upstream-integration-model.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://huggingface.co/docs/xet/en/api
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * - https://github.com/huggingface/xet-core
 * Tests:
 * - packages/storage/test/xet-bridge.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandExecutionError,
  CommandTimeoutError
} from '../src/command-runner.ts';
import {
  ServiceBackedXetFileMaterializer,
  ServiceBackedXetSnapshotEvidenceProvider,
  XetBridgeError,
  createXetSnapshotResult
} from '../src/xet-source-repository.ts';

test('CommandBackedXetSnapshotEvidenceProvider maps command failures into typed bridge errors', async () => {
  const providerModule = await import('../src/xet-source-repository.ts');
  const provider = new providerModule.CommandBackedXetSnapshotEvidenceProvider({
    runner: {
      async run(execution) {
        throw new CommandExecutionError(execution, {
          exitCode: 9,
          stdout: '',
          stderr: 'permission denied'
        });
      }
    },
    command: 'xet-bridge'
  });

  await assert.rejects(
    () =>
      provider.captureSnapshot({
        assetVersionId: 'ver_fail',
        localPath: 'C:\\staging\\fail.bin',
        sourceFilename: 'fail.bin'
      }),
    (error) => {
      assert.ok(error instanceof XetBridgeError);
      assert.equal(error.operation, 'snapshot');
      assert.equal(error.reason, 'command-failed');
      assert.equal(error.transport, 'command');
      assert.match(error.message, /permission denied/);
      return true;
    }
  );
});

test('CommandBackedXetSnapshotEvidenceProvider maps command timeouts into typed bridge errors', async () => {
  const providerModule = await import('../src/xet-source-repository.ts');
  const provider = new providerModule.CommandBackedXetSnapshotEvidenceProvider({
    runner: {
      async run(execution) {
        throw new CommandTimeoutError(execution, 25);
      }
    },
    command: 'xet-bridge'
  });

  await assert.rejects(
    () =>
      provider.captureSnapshot({
        assetVersionId: 'ver_timeout',
        localPath: 'C:\\staging\\timeout.bin',
        sourceFilename: 'timeout.bin'
      }),
    (error) => {
      assert.ok(error instanceof XetBridgeError);
      assert.equal(error.operation, 'snapshot');
      assert.equal(error.reason, 'timeout');
      assert.equal(error.transport, 'command');
      return true;
    }
  );
});

test('ServiceBackedXetSnapshotEvidenceProvider maps service failures into typed bridge errors', async () => {
  const provider = new ServiceBackedXetSnapshotEvidenceProvider({
    endpoint: 'https://xet.service.internal',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'service unavailable' }), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          'content-type': 'application/json'
        }
      }),
    timeoutMs: 1000
  });

  await assert.rejects(
    () =>
      provider.captureSnapshot({
        assetVersionId: 'ver_service_fail',
        localPath: 'C:\\staging\\service-fail.bin',
        sourceFilename: 'service-fail.bin'
      }),
    (error) => {
      assert.ok(error instanceof XetBridgeError);
      assert.equal(error.operation, 'snapshot');
      assert.equal(error.reason, 'service-failed');
      assert.equal(error.transport, 'service');
      assert.equal(error.statusCode, 503);
      return true;
    }
  );
});

test('ServiceBackedXetSnapshotEvidenceProvider aborts on timeout', async () => {
  const provider = new ServiceBackedXetSnapshotEvidenceProvider({
    endpoint: 'https://xet.service.internal',
    fetchImpl: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    timeoutMs: 10
  });

  await assert.rejects(
    () =>
      provider.captureSnapshot({
        assetVersionId: 'ver_service_timeout',
        localPath: 'C:\\staging\\service-timeout.bin',
        sourceFilename: 'service-timeout.bin'
      }),
    (error) => {
      assert.ok(error instanceof XetBridgeError);
      assert.equal(error.operation, 'snapshot');
      assert.equal(error.reason, 'timeout');
      assert.equal(error.transport, 'service');
      return true;
    }
  );
});

test('Service-backed Xet bridge validates endpoint configuration eagerly', () => {
  assert.throws(
    () =>
      new ServiceBackedXetSnapshotEvidenceProvider({
        endpoint: 'not-a-valid-url',
        timeoutMs: 1000
      }),
    (error) => {
      assert.ok(error instanceof XetBridgeError);
      assert.equal(error.reason, 'invalid-config');
      return true;
    }
  );
});

test('ServiceBackedXetFileMaterializer restores using engine-neutral snapshot evidence shape', async () => {
  let requestBody:
    | {
        destinationPath?: string;
        snapshot?: {
          canonicalSourceId?: string;
          reconstructionHandles?: Array<{ kind?: string; value?: string }>;
          substrateHints?: Record<string, string>;
        };
      }
    | undefined;

  const materializer = new ServiceBackedXetFileMaterializer({
    endpoint: 'https://xet.service.internal',
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ restoredPath: 'C:\\restore\\service.bin' }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    },
    timeoutMs: 1000
  });
  const snapshot = createXetSnapshotResult(
    {
      assetVersionId: 'ver_service_restore',
      localPath: 'C:\\staging\\service.bin',
      sourceFilename: 'service.bin'
    },
    {
      fileId: 'file_service_restore',
      terms: [
        {
          xorbHash: 'xorb_service_restore',
          startChunkIndex: 0,
          endChunkIndex: 2
        }
      ],
      shardIds: ['shard_service_restore'],
      fetchEndpoint: 'https://cas.example.test/v1/reconstructions/file_service_restore'
    }
  );

  await materializer.materializeFile({
    canonicalSourceId: snapshot.canonicalSourceId,
    destinationPath: 'C:\\restore\\service.bin',
    snapshot
  });

  assert.equal(requestBody?.destinationPath, 'C:\\restore\\service.bin');
  assert.equal(requestBody?.snapshot?.canonicalSourceId, 'file_service_restore');
  assert.equal(requestBody?.snapshot?.reconstructionHandles?.[0]?.kind, 'manifest');
  assert.equal(
    requestBody?.snapshot?.substrateHints?.fetchEndpoint,
    'https://cas.example.test/v1/reconstructions/file_service_restore'
  );
});
