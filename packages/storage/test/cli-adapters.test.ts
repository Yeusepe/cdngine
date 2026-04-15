/**
 * Purpose: Verifies that CLI-backed storage adapters keep Kopia and ORAS on a controlled process boundary with predictable arguments and parsed results.
 * Governing docs:
 * - docs/upstream-integration-model.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/storage-tiering-and-materialization.md
 * External references:
 * - https://kopia.io/docs/reference/command-line/common/snapshot-create/
 * - https://oras.land/docs/commands/oras_push/
 * Tests:
 * - packages/storage/test/cli-adapters.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { KopiaSourceRepository } from '../src/kopia-source-repository.ts';
import { OrasArtifactPublisher } from '../src/oras-artifact-publisher.ts';

class FakeRunner {
  readonly invocations: Array<{ args: string[]; command: string }> = [];

  constructor(private readonly outputs: string[]) {}

  async run(execution: { args: string[]; command: string }) {
    this.invocations.push({
      command: execution.command,
      args: execution.args
    });

    return {
      exitCode: 0,
      stdout: this.outputs.shift() ?? '{}',
      stderr: ''
    };
  }
}

test('KopiaSourceRepository snapshots, lists, and restores through the runner boundary', async () => {
  const runner = new FakeRunner([
    JSON.stringify({
      id: 'snap-123',
      source: {
        path: '/scratch/input'
      }
    }),
    JSON.stringify([
      {
        id: 'snap-123',
        endTime: '2026-01-15T18:05:00Z'
      }
    ]),
    '{}'
  ]);

  const repository = new KopiaSourceRepository({
    runner,
    executable: 'kopia'
  });

  const snapshot = await repository.snapshotFromPath({
    assetVersionId: 'ver_123',
    localPath: '/scratch/input',
    sourceFilename: 'hero-banner.png',
    metadata: {
      serviceNamespaceId: 'media-platform'
    }
  });

  const snapshots = await repository.listSnapshots('ver_123');
  const restore = await repository.restoreToPath({
    canonicalSourceId: snapshot.canonicalSourceId,
    destinationPath: '/scratch/output'
  });

  assert.equal(snapshot.snapshotId, 'snap-123');
  assert.equal(snapshots[0]?.snapshotId, 'snap-123');
  assert.equal(restore.restoredPath, '/scratch/output');
  assert.deepEqual(runner.invocations[0]?.args.slice(0, 4), [
    'snapshot',
    'create',
    '/scratch/input',
    '--json'
  ]);
  assert.match(runner.invocations[0]?.args.join(' '), /assetVersionId:ver_123/);
});

test('OrasArtifactPublisher pushes bundles through the runner boundary and parses digests', async () => {
  const runner = new FakeRunner([
    JSON.stringify({
      reference: 'registry.cdngine.local/assets/image:latest',
      descriptor: {
        digest: 'sha256:abc123',
        mediaType: 'application/vnd.cdngine.bundle.v1+json'
      }
    })
  ]);

  const publisher = new OrasArtifactPublisher({
    runner,
    executable: 'oras'
  });

  const artifact = await publisher.pushBundle({
    reference: 'registry.cdngine.local/assets/image:latest',
    mediaType: 'application/vnd.cdngine.bundle.v1+json',
    path: 'bundle.json'
  });

  assert.equal(artifact.digest, 'sha256:abc123');
  assert.equal(artifact.mediaType, 'application/vnd.cdngine.bundle.v1+json');
  assert.deepEqual(runner.invocations[0]?.args.slice(0, 3), [
    'push',
    'registry.cdngine.local/assets/image:latest',
    'bundle.json:application/vnd.cdngine.bundle.v1+json'
  ]);
});
