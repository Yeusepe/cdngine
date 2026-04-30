/**
 * Purpose: Verifies that S3-compatible storage adapters preserve logical role prefixes and avoid leaking topology details into callers.
 * Governing docs:
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/original-source-delivery.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://github.com/rustfs/rustfs
 * - https://github.com/seaweedfs/seaweedfs
 * - https://tus.io/protocols/resumable-upload
 * Tests:
 * - packages/storage/test/s3-compatible-object-stores.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  S3CompatibleDerivedObjectStore,
  S3CompatibleExportsObjectStore,
  S3CompatibleStagingBlobStore
} from '../src/s3-compatible-object-stores.ts';

class FakeS3Client {
  readonly commands: Array<{ input: Record<string, unknown>; name: string }> = [];
  private readonly handlers: Record<
    string,
    (input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
  >;

  constructor(
    handlers: Record<
      string,
      (input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
    >
  ) {
    this.handlers = handlers;
  }

  async send(command: { input: Record<string, unknown>; constructor: { name: string } }) {
    this.commands.push({
      input: command.input,
      name: command.constructor.name
    });

    const handler = this.handlers[command.constructor.name];

    if (!handler) {
      return {};
    }

    return handler(command.input);
  }
}

test('staging adapter returns tus upload targets anchored to the ingest role prefix', async () => {
  const store = new S3CompatibleStagingBlobStore({
    client: new FakeS3Client({}),
    target: {
      role: 'ingest',
      bucket: 'cdngine-data',
      prefix: 'ingest',
      targetKey: 'cdngine-data/ingest'
    },
    uploadBaseUrl: 'https://uploads.cdngine.local/files'
  });

  const target = await store.createUploadTarget({
    objectKey: 'media-platform/asset/upl_123',
    contentType: 'image/png',
    byteLength: 1n,
    expiresAt: new Date('2026-01-15T18:00:00Z')
  });

  assert.equal(target.protocol, 'tus');
  assert.equal(target.method, 'PATCH');
  assert.equal(
    target.url,
    'https://uploads.cdngine.local/files/ingest/media-platform/asset/upl_123'
  );
});

test('derived adapter publishes and signs objects under the derived role prefix', async () => {
  const client = new FakeS3Client({
    PutObjectCommand: (input) => ({ ETag: '"etag-123"', input }),
    HeadObjectCommand: () => ({
      ContentLength: 512,
      ETag: '"etag-123"',
      Metadata: { 'cdngine-checksum-sha256': 'abc123' }
    })
  });

  const store = new S3CompatibleDerivedObjectStore(
    {
      client,
      target: {
        role: 'derived',
        bucket: 'cdngine-derived',
        prefix: 'derived',
        targetKey: 'cdngine-derived/derived'
      }
    },
    async (_client, command) => `signed:${String(command.input.Key)}`
  );

  const published = await store.publishObject({
    objectKey: 'image-default/webp-1600',
    contentType: 'image/webp',
    byteLength: 512n,
    body: 'binary-data',
    checksum: {
      algorithm: 'sha256',
      value: 'abc123'
    }
  });

  const head = await store.headObject('image-default/webp-1600');
  const signed = await store.issueSignedReadUrl(
    'image-default/webp-1600',
    new Date('2026-01-15T18:30:00Z')
  );

  assert.equal(published.key, 'derived/image-default/webp-1600');
  assert.equal(head?.key, 'derived/image-default/webp-1600');
  assert.deepEqual(head?.checksum, { algorithm: 'sha256', value: 'abc123' });
  assert.equal(signed.url, 'signed:derived/image-default/webp-1600');
  assert.equal(client.commands[0]?.name, 'PutObjectCommand');
});

test('exports adapter deletes and signs objects under the exports role prefix', async () => {
  const client = new FakeS3Client({
    DeleteObjectCommand: () => ({}),
    PutObjectCommand: () => ({ ETag: '"export-etag"' })
  });

  const store = new S3CompatibleExportsObjectStore(
    {
      client,
      target: {
        role: 'exports',
        bucket: 'cdngine-exports',
        prefix: 'exports',
        targetKey: 'cdngine-exports/exports'
      }
    },
    async (_client, command) => `signed:${String(command.input.Key)}`
  );

  const published = await store.publishExport({
    objectKey: 'ast_123/ver_456/source.psd',
    contentType: 'image/vnd.adobe.photoshop',
    byteLength: 4096n,
    body: 'binary-data'
  });

  await store.deleteObject('ast_123/ver_456/source.psd');
  const signed = await store.issueSignedReadUrl(
    'ast_123/ver_456/source.psd',
    new Date('2026-01-15T18:45:00Z')
  );

  assert.equal(published.key, 'exports/ast_123/ver_456/source.psd');
  assert.equal(signed.url, 'signed:exports/ast_123/ver_456/source.psd');
  assert.equal(client.commands[1]?.name, 'DeleteObjectCommand');
});

test('exports adapter forwards stream bodies for source export publication', async () => {
  const client = new FakeS3Client({
    PutObjectCommand: () => ({ ETag: '"export-etag"' })
  });
  const store = new S3CompatibleExportsObjectStore({
    client,
    target: {
      role: 'exports',
      bucket: 'cdngine-exports',
      prefix: 'exports',
      targetKey: 'cdngine-exports/exports'
    }
  });
  const body = Readable.from(['streamed-export']);

  const published = await store.publishExport({
    objectKey: 'ast_123/ver_456/source.psd',
    contentType: 'image/vnd.adobe.photoshop',
    byteLength: 15n,
    body
  });

  assert.equal(published.key, 'exports/ast_123/ver_456/source.psd');
  assert.equal(client.commands[0]?.name, 'PutObjectCommand');
  assert.equal(client.commands[0]?.input.Body, body);
});
