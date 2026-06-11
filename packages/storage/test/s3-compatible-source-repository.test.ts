/**
 * Purpose: Verifies the S3-compatible canonical source repository promotes staged tusd objects into the durable source role and can restore them by recorded evidence.
 * Governing docs:
 * - docs/architecture.md
 * - docs/source-plane-strategy.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/environment-and-deployment.md
 * External references:
 * - https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
 * - https://pkg.go.dev/github.com/tus/tusd/pkg/s3store
 * Tests:
 * - packages/storage/test/s3-compatible-source-repository.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  S3CompatibleSourceRepository
} from '../src/s3-compatible-object-stores.ts';

class FakeS3Client {
  readonly commands: Array<{ input: Record<string, unknown>; name: string }> = [];
  readonly objects = new Map<string, { body: Buffer; contentType?: string; metadata: Record<string, string> }>();

  async send(command: { input: Record<string, unknown>; constructor: { name: string } }) {
    this.commands.push({
      input: command.input,
      name: command.constructor.name
    });

    switch (command.constructor.name) {
      case 'CopyObjectCommand': {
        const source = this.objects.get(String(command.input.CopySource));
        if (!source) {
          const error = new Error('No such key');
          error.name = 'NoSuchKey';
          throw error;
        }
        this.objects.set(`${command.input.Bucket}/${command.input.Key}`, {
          body: source.body,
          contentType: source.contentType,
          metadata: source.metadata
        });
        return { CopyObjectResult: { ETag: `"${command.input.Key}"` } };
      }
      case 'GetObjectCommand': {
        const object = this.objects.get(`${command.input.Bucket}/${command.input.Key}`);
        if (!object) {
          const error = new Error('No such key');
          error.name = 'NoSuchKey';
          throw error;
        }
        return {
          Body: {
            async transformToByteArray() {
              return object.body;
            }
          },
          ContentLength: object.body.length,
          ContentType: object.contentType,
          Metadata: object.metadata
        };
      }
      case 'HeadObjectCommand': {
        const object = this.objects.get(`${command.input.Bucket}/${command.input.Key}`);
        if (!object) {
          const error = new Error('No such key');
          error.name = 'NoSuchKey';
          throw error;
        }
        return {
          ContentLength: object.body.length,
          ETag: `"${command.input.Key}"`,
          LastModified: new Date('2026-04-01T00:00:00Z'),
          Metadata: object.metadata
        };
      }
      case 'ListObjectsV2Command': {
        const bucket = String(command.input.Bucket);
        const prefix = String(command.input.Prefix ?? '');
        return {
          Contents: [...this.objects.keys()]
            .filter((key) => key.startsWith(`${bucket}/${prefix}`))
            .map((key) => ({
              Key: key.slice(bucket.length + 1),
              LastModified: new Date('2026-04-01T00:00:00Z')
            }))
        };
      }
      default:
        return {};
    }
  }
}

const ingestTarget = {
  role: 'ingest' as const,
  bucket: 'cdngine-data',
  prefix: 'ingest',
  targetKey: 'cdngine-data/ingest'
};

const sourceTarget = {
  role: 'source' as const,
  bucket: 'cdngine-data',
  prefix: 'source',
  targetKey: 'cdngine-data/source'
};

test('S3CompatibleSourceRepository promotes staged objects into the source role and restores recorded snapshots', async (context) => {
  const client = new FakeS3Client();
  client.objects.set('cdngine-data/ingest/yucp-backstage/avatar.zip', {
    body: Buffer.from('durable-source'),
    contentType: 'application/zip',
    metadata: { 'cdngine-checksum-sha256': 'sha256-source' }
  });
  const repository = new S3CompatibleSourceRepository({
    client,
    ingestTarget,
    sourceTarget
  });

  const snapshot = await repository.snapshotFromPath({
    assetVersionId: 'ver_source_001',
    localPath: 'staging://cdngine-data/ingest/yucp-backstage/avatar.zip',
    logicalByteLength: 14n,
    sourceDigests: [{ algorithm: 'sha256', value: 'sha256-source' }],
    sourceFilename: 'avatar.zip'
  });

  assert.equal(snapshot.repositoryEngine, 'object-store');
  assert.equal(snapshot.canonicalSourceId, 's3://cdngine-data/source/ver_source_001/avatar.zip');
  assert.equal(snapshot.snapshotId, 's3://cdngine-data/source/ver_source_001/avatar.zip');
  assert.equal(snapshot.logicalPath, 'source/ver_source_001/avatar.zip');
  assert.deepEqual(snapshot.reconstructionHandles, [
    {
      kind: 'opaque',
      value: 's3://cdngine-data/source/ver_source_001/avatar.zip'
    }
  ]);
  assert.ok(client.objects.has('cdngine-data/source/ver_source_001/avatar.zip'));

  const restoreDir = await mkdtemp(path.join(tmpdir(), 'cdngine-s3-source-'));
  context.after(() => rm(restoreDir, { recursive: true, force: true }));
  const restorePath = path.join(restoreDir, 'avatar.zip');
  const restored = await repository.restoreToPath({
    canonicalSourceId: snapshot.canonicalSourceId,
    destinationPath: restorePath,
    snapshot
  });

  assert.equal(restored.restoredPath, restorePath);
  assert.equal(await readFile(restorePath, 'utf8'), 'durable-source');
  assert.deepEqual(
    client.commands.map((command) => command.name),
    ['HeadObjectCommand', 'CopyObjectCommand', 'HeadObjectCommand', 'GetObjectCommand']
  );
});

test('S3CompatibleSourceRepository rejects non-staging source paths instead of treating local files as durable source evidence', async () => {
  const repository = new S3CompatibleSourceRepository({
    client: new FakeS3Client(),
    ingestTarget,
    sourceTarget
  });

  await assert.rejects(
    () =>
      repository.snapshotFromPath({
        assetVersionId: 'ver_source_002',
        localPath: '/tmp/avatar.zip',
        sourceFilename: 'avatar.zip'
      }),
    /Object-store source repository snapshots require staging:\/\/ bucket references/
  );
});
