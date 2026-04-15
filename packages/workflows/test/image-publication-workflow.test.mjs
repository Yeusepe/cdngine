/**
 * Purpose: Verifies that the first image publication workflow creates deterministic derivatives, publishes a manifest, and keeps replayed runs stable.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/pipeline-capability-model.md
 * - docs/adr/0003-deterministic-derivative-keys.md
 * Tests:
 * - packages/workflows/test/image-publication-workflow.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryImagePublicationStore
} from '@cdngine/registry';

import {
  runImagePublicationWorkflow
} from '../dist/image-publication-workflow.js';

class FakeDerivedObjectStore {
  constructor() {
    this.objects = new Map();
  }

  async headObject(objectKey) {
    return this.objects.get(objectKey) ?? null;
  }

  async issueSignedReadUrl(objectKey, expiresAt) {
    return {
      expiresAt,
      url: `signed:${objectKey}`
    };
  }

  async publishObject(input) {
    const key = `derived/${input.objectKey}`;
    this.objects.set(input.objectKey, {
      bucket: 'cdngine-derived',
      byteLength: input.byteLength,
      checksum: input.checksum,
      key
    });

    return {
      bucket: 'cdngine-derived',
      key
    };
  }
}

class FakeImageProcessorActivity {
  constructor() {
    this.calls = [];
  }

  async processDerivative(input) {
    this.calls.push(input);
    const body = JSON.stringify({
      canonicalSourceId: input.canonicalSourceId,
      recipeId: input.recipeBinding.recipeId
    });

    return {
      body,
      byteLength: BigInt(Buffer.byteLength(body)),
      contentType: input.recipeBinding.contentType,
      metadata: {
        processor: 'fake-image-processor'
      }
    };
  }
}

test('runImagePublicationWorkflow turns one canonical image version into deterministic published derivatives and a manifest', async () => {
  const publicationStore = new InMemoryImagePublicationStore({
    versions: [
      {
        assetId: 'ast_001',
        canonicalLogicalPath: 'kopia://snap_001/source/hero-banner.png',
        canonicalSourceId: 'src_001',
        detectedContentType: 'image/png',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 1024n,
        sourceChecksumValue: 'src-sha',
        sourceFilename: 'hero-banner.png',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });
  const derivedObjectStore = new FakeDerivedObjectStore();
  const processorActivity = new FakeImageProcessorActivity();

  const result = await runImagePublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:20:00.000Z'),
      processorActivity,
      publicationStore
    }
  );

  const derivatives = await publicationStore.listPublishedDerivatives('ver_001');
  const manifest = await publicationStore.readManifest('ver_001', 'image-default', 'scope_public');

  assert.equal(result.version.lifecycleState, 'published');
  assert.equal(derivatives.length, 2);
  assert.deepEqual(
    derivatives.map((item) => item.deterministicKey),
    [
      'deriv/media-platform/ast_001/ver_001/thumbnail-small/thumbnail-small',
      'deriv/media-platform/ast_001/ver_001/webp-master/webp-master'
    ]
  );
  assert.equal(manifest?.objectKey, 'derived/manifests/media-platform/ast_001/ver_001/image-default.json');
  assert.equal(processorActivity.calls.length, 2);
});

test('runImagePublicationWorkflow keeps derivative keys and manifest shape stable on replay', async () => {
  const publicationStore = new InMemoryImagePublicationStore({
    versions: [
      {
        assetId: 'ast_001',
        canonicalLogicalPath: 'kopia://snap_001/source/hero-banner.png',
        canonicalSourceId: 'src_001',
        detectedContentType: 'image/png',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 1024n,
        sourceChecksumValue: 'src-sha',
        sourceFilename: 'hero-banner.png',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });
  const derivedObjectStore = new FakeDerivedObjectStore();
  const processorActivity = new FakeImageProcessorActivity();

  const first = await runImagePublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:20:00.000Z'),
      processorActivity,
      publicationStore
    }
  );
  const second = await runImagePublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:21:00.000Z'),
      processorActivity,
      publicationStore
    }
  );

  assert.deepEqual(
    first.derivatives.map((item) => item.deterministicKey),
    second.derivatives.map((item) => item.deterministicKey)
  );
  assert.deepEqual(
    first.manifest.manifestPayload.derivatives,
    second.manifest.manifestPayload.derivatives
  );
  assert.equal((await publicationStore.listPublishedDerivatives('ver_001')).length, 2);
});
