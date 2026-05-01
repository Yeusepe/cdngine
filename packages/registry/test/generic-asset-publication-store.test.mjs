/**
 * Purpose: Verifies that the generic asset publication store transitions canonical versions through processing to published while upserting preserve-original derivatives and manifests.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * Tests:
 * - packages/registry/test/generic-asset-publication-store.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryGenericAssetPublicationStore
} from '../dist/index.js';

test('publishGenericAssetVersion marks the version published and preserves the published original record', async () => {
  const store = new InMemoryGenericAssetPublicationStore({
    versions: [
      {
        assetId: 'ast_001',
        canonicalSourceEvidence: {
          repositoryEngine: 'xet',
          canonicalSourceId: 'src_001',
          canonicalSnapshotId: 'snap_001',
          canonicalLogicalPath: 'source/media-platform/ast_001/ver_001/original/archive.bin',
          canonicalDigestSet: [
            {
              algorithm: 'sha256',
              value: 'original-sha'
            }
          ]
        },
        detectedContentType: 'application/octet-stream',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 2048n,
        sourceChecksumValue: 'original-sha',
        sourceFilename: 'archive.bin',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });

  await store.beginGenericAssetPublication({
    startedAt: new Date('2026-01-15T18:45:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
  });

  const publishedVersion = await store.publishGenericAssetVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [
      {
        assetVersionId: 'ver_001',
        byteLength: 2048n,
        checksumValue: 'original-sha',
        contentType: 'application/octet-stream',
        deliveryScopeId: 'scope_public',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/preserve-original/preserve-original',
        publicationState: 'published',
        publishedAt: new Date('2026-01-15T18:45:05.000Z'),
        recipeId: 'preserve-original',
        schemaVersion: 'v1',
        storageBucket: 'cdngine-derived',
        storageKey: 'derived/archive.bin',
        variantKey: 'preserve-original'
      }
    ],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'manifest-sha',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'generic-asset-default'
      },
      manifestType: 'generic-asset-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/generic-asset-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:45:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:45:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
  });

  const derivatives = await store.listPublishedDerivatives('ver_001');
  const manifest = await store.readManifest('ver_001', 'generic-asset-default', 'scope_public');

  assert.equal(publishedVersion.lifecycleState, 'published');
  assert.equal(derivatives.length, 1);
  assert.equal(
    derivatives[0].deterministicKey,
    'deriv/media-platform/ast_001/ver_001/preserve-original/preserve-original'
  );
  assert.equal(
    manifest?.objectKey,
    'manifests/media-platform/ast_001/ver_001/generic-asset-default.json'
  );
});

test('publishGenericAssetVersion upserts preserve-original derivatives instead of multiplying rows on replay', async () => {
  const store = new InMemoryGenericAssetPublicationStore({
    versions: [
      {
        assetId: 'ast_001',
        canonicalSourceEvidence: {
          repositoryEngine: 'xet',
          canonicalSourceId: 'src_001',
          canonicalSnapshotId: 'snap_001',
          canonicalLogicalPath: 'source/media-platform/ast_001/ver_001/original/archive.bin',
          canonicalDigestSet: [
            {
              algorithm: 'sha256',
              value: 'original-sha'
            }
          ]
        },
        detectedContentType: 'application/octet-stream',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 2048n,
        sourceChecksumValue: 'original-sha',
        sourceFilename: 'archive.bin',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });

  const publication = {
    assetVersionId: 'ver_001',
    byteLength: 2048n,
    checksumValue: 'original-sha',
    contentType: 'application/octet-stream',
    deliveryScopeId: 'scope_public',
    deterministicKey: 'deriv/media-platform/ast_001/ver_001/preserve-original/preserve-original',
    publicationState: 'published',
    publishedAt: new Date('2026-01-15T18:45:05.000Z'),
    recipeId: 'preserve-original',
    schemaVersion: 'v1',
    storageBucket: 'cdngine-derived',
    storageKey: 'derived/archive.bin',
    variantKey: 'preserve-original'
  };

  await store.beginGenericAssetPublication({
    startedAt: new Date('2026-01-15T18:45:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
  });
  await store.publishGenericAssetVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [publication],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'manifest-sha',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'generic-asset-default'
      },
      manifestType: 'generic-asset-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/generic-asset-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:45:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:45:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
  });

  await store.beginGenericAssetPublication({
    startedAt: new Date('2026-01-15T18:46:00.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
  });
  await store.publishGenericAssetVersion({
    deliveryScopeId: 'scope_public',
    derivatives: [publication],
    manifest: {
      assetVersionId: 'ver_001',
      checksumValue: 'manifest-sha',
      deliveryScopeId: 'scope_public',
      manifestPayload: {
        manifestType: 'generic-asset-default'
      },
      manifestType: 'generic-asset-default',
      objectKey: 'manifests/media-platform/ast_001/ver_001/generic-asset-default.json',
      publicationState: 'published',
      publishedAt: new Date('2026-01-15T18:46:05.000Z'),
      schemaVersion: 'v1'
    },
    publishedAt: new Date('2026-01-15T18:46:05.000Z'),
    versionId: 'ver_001',
    workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
  });

  const derivatives = await store.listPublishedDerivatives('ver_001');

  assert.equal(derivatives.length, 1);
});
