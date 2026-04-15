/**
 * Purpose: Verifies that the image publication store transitions canonical versions through processing to published while upserting deterministic derivatives and manifests.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * Tests:
 * - packages/registry/test/image-publication-store.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryImagePublicationStore
} from '../dist/image-publication-store.js';

test('publishImageVersion marks the version published and preserves deterministic derivative records', async () => {
  const store = new InMemoryImagePublicationStore({
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

  await store.beginImagePublication({
    startedAt: new Date('2026-01-15T18:15:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
  });

  const publishedVersion = await store.publishImageVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [
      {
        assetVersionId: 'ver_001',
        byteLength: 512n,
        checksumValue: 'sha-webp',
        contentType: 'image/webp',
        deliveryScopeId: 'scope_public',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/webp-master/webp-master',
        publicationState: 'published',
        publishedAt: new Date('2026-01-15T18:15:05.000Z'),
        recipeId: 'webp-master',
        schemaVersion: 'v1',
        storageBucket: 'cdngine-derived',
        storageKey: 'derived/hero-banner.webp',
        variantKey: 'webp-master'
      }
    ],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'sha-manifest',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'image-default'
      },
      manifestType: 'image-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/image-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:15:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:15:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
  });

  const derivatives = await store.listPublishedDerivatives('ver_001');
  const manifest = await store.readManifest('ver_001', 'image-default', 'scope_public');

  assert.equal(publishedVersion.lifecycleState, 'published');
  assert.equal(derivatives.length, 1);
  assert.equal(derivatives[0].deterministicKey, 'deriv/media-platform/ast_001/ver_001/webp-master/webp-master');
  assert.equal(manifest?.objectKey, 'manifests/media-platform/ast_001/ver_001/image-default.json');
});

test('publishImageVersion upserts deterministic derivatives instead of multiplying rows on replay', async () => {
  const store = new InMemoryImagePublicationStore({
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

  await store.beginImagePublication({
    startedAt: new Date('2026-01-15T18:15:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
  });

  const publication = {
    assetVersionId: 'ver_001',
    byteLength: 512n,
    checksumValue: 'sha-webp',
    contentType: 'image/webp',
    deliveryScopeId: 'scope_public',
    deterministicKey: 'deriv/media-platform/ast_001/ver_001/webp-master/webp-master',
    publicationState: 'published',
    publishedAt: new Date('2026-01-15T18:15:05.000Z'),
    recipeId: 'webp-master',
    schemaVersion: 'v1',
    storageBucket: 'cdngine-derived',
    storageKey: 'derived/hero-banner.webp',
    variantKey: 'webp-master'
  };

  await store.publishImageVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [publication],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'sha-manifest',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'image-default'
      },
      manifestType: 'image-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/image-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:15:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:15:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
  });

  await store.beginImagePublication({
    startedAt: new Date('2026-01-15T18:16:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
  });

  await store.publishImageVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [publication],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'sha-manifest',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'image-default'
      },
      manifestType: 'image-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/image-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:16:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:16:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:image-derivation-v1'
  });

  const derivatives = await store.listPublishedDerivatives('ver_001');

  assert.equal(derivatives.length, 1);
});
