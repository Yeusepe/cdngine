/**
 * Purpose: Verifies that the presentation publication store transitions canonical versions through processing to published while upserting deterministic normalized-document and slide-image records.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * Tests:
 * - packages/registry/test/presentation-publication-store.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryPresentationPublicationStore
} from '../dist/index.js';

test('publishPresentationVersion marks the version published and preserves deterministic slide records', async () => {
  const store = new InMemoryPresentationPublicationStore({
    versions: [
      {
        assetId: 'ast_001',
        canonicalLogicalPath: 'kopia://snap_001/source/event-deck.pdf',
        canonicalSourceId: 'src_001',
        detectedContentType: 'application/pdf',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 4096n,
        sourceChecksumValue: 'src-sha',
        sourceFilename: 'event-deck.pdf',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });

  await store.beginPresentationPublication({
    startedAt: new Date('2026-01-15T18:35:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
  });

  const publishedVersion = await store.publishPresentationVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [
      {
        assetVersionId: 'ver_001',
        byteLength: 1024n,
        checksumValue: 'pdf-sha',
        contentType: 'application/pdf',
        deliveryScopeId: 'scope_public',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/normalized-pdf/normalized-pdf',
        pageNumber: 0,
        publicationState: 'published',
        publishedAt: new Date('2026-01-15T18:35:05.000Z'),
        recipeId: 'normalized-pdf',
        schemaVersion: 'v1',
        storageBucket: 'cdngine-derived',
        storageKey: 'derived/event-deck.pdf',
        variantKey: 'normalized-pdf'
      },
      {
        assetVersionId: 'ver_001',
        byteLength: 256n,
        checksumValue: 'slide-1',
        contentType: 'image/webp',
        deliveryScopeId: 'scope_public',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/slide-images/slide-001',
        pageNumber: 1,
        publicationState: 'published',
        publishedAt: new Date('2026-01-15T18:35:05.000Z'),
        recipeId: 'slide-images',
        schemaVersion: 'v1',
        storageBucket: 'cdngine-derived',
        storageKey: 'derived/event-deck-slide-001.webp',
        variantKey: 'slide-001'
      }
    ],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'manifest-sha',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'presentation-default'
      },
      manifestType: 'presentation-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/presentation-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:35:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:35:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
  });

  const derivatives = await store.listPublishedDerivatives('ver_001');
  const manifest = await store.readManifest('ver_001', 'presentation-default', 'scope_public');

  assert.equal(publishedVersion.lifecycleState, 'published');
  assert.deepEqual(derivatives.map((item) => item.pageNumber), [0, 1]);
  assert.equal(manifest?.objectKey, 'manifests/media-platform/ast_001/ver_001/presentation-default.json');
});

test('publishPresentationVersion upserts deterministic derivatives instead of multiplying rows on replay', async () => {
  const store = new InMemoryPresentationPublicationStore({
    versions: [
      {
        assetId: 'ast_001',
        canonicalLogicalPath: 'kopia://snap_001/source/event-deck.pdf',
        canonicalSourceId: 'src_001',
        detectedContentType: 'application/pdf',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 4096n,
        sourceChecksumValue: 'src-sha',
        sourceFilename: 'event-deck.pdf',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });

  const publication = {
    assetVersionId: 'ver_001',
    byteLength: 256n,
    checksumValue: 'slide-1',
    contentType: 'image/webp',
    deliveryScopeId: 'scope_public',
    deterministicKey: 'deriv/media-platform/ast_001/ver_001/slide-images/slide-001',
    pageNumber: 1,
    publicationState: 'published',
    publishedAt: new Date('2026-01-15T18:35:05.000Z'),
    recipeId: 'slide-images',
    schemaVersion: 'v1',
    storageBucket: 'cdngine-derived',
    storageKey: 'derived/event-deck-slide-001.webp',
    variantKey: 'slide-001'
  };

  await store.beginPresentationPublication({
    startedAt: new Date('2026-01-15T18:35:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
  });
  await store.publishPresentationVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [publication],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'manifest-sha',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'presentation-default'
      },
      manifestType: 'presentation-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/presentation-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:35:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:35:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
  });

  await store.beginPresentationPublication({
    startedAt: new Date('2026-01-15T18:36:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
  });
  await store.publishPresentationVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [publication],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'manifest-sha',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'presentation-default'
      },
      manifestType: 'presentation-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/presentation-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:36:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:36:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
  });

  const derivatives = await store.listPublishedDerivatives('ver_001');

  assert.equal(derivatives.length, 1);
});
