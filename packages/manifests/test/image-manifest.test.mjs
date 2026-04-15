/**
 * Purpose: Verifies deterministic derivative-key generation and image-manifest stability across repeated publication orderings.
 * Governing docs:
 * - docs/adr/0003-deterministic-derivative-keys.md
 * - docs/domain-model.md
 * Tests:
 * - packages/manifests/test/image-manifest.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeterministicDerivativeKey,
  buildImageManifestObjectKey
} from '../dist/deterministic-derivative-keys.js';
import {
  buildImageAssetManifest
} from '../dist/image-manifest.js';

test('deterministic derivative keys stay stable for repeated processing inputs', () => {
  const first = buildDeterministicDerivativeKey({
    assetId: 'ast_001',
    recipeId: 'webp-master',
    serviceNamespaceId: 'media-platform',
    variantKey: 'webp-master',
    versionId: 'ver_001'
  });
  const second = buildDeterministicDerivativeKey({
    assetId: 'ast_001',
    recipeId: 'webp-master',
    serviceNamespaceId: 'media-platform',
    variantKey: 'webp-master',
    versionId: 'ver_001'
  });

  assert.equal(first, 'deriv/media-platform/ast_001/ver_001/webp-master/webp-master');
  assert.equal(second, first);
  assert.equal(
    buildImageManifestObjectKey({
      assetId: 'ast_001',
      manifestType: 'image-default',
      serviceNamespaceId: 'media-platform',
      versionId: 'ver_001'
    }),
    'manifests/media-platform/ast_001/ver_001/image-default.json'
  );
});

test('image manifests sort derivatives by deterministic key so replayed publication stays stable', () => {
  const manifest = buildImageAssetManifest({
    assetId: 'ast_001',
    derivatives: [
      {
        byteLength: 512n,
        checksum: 'b',
        contentType: 'image/webp',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/webp-master/webp-master',
        recipeId: 'webp-master',
        schemaVersion: 'v1',
        variantKey: 'webp-master'
      },
      {
        byteLength: 128n,
        checksum: 'a',
        contentType: 'image/webp',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/thumbnail-small/thumbnail-small',
        recipeId: 'thumbnail-small',
        schemaVersion: 'v1',
        variantKey: 'thumbnail-small'
      }
    ],
    generatedAt: new Date('2026-01-15T18:10:00.000Z'),
    manifestType: 'image-default',
    schemaVersion: 'v1',
    serviceNamespaceId: 'media-platform',
    versionId: 'ver_001'
  });

  assert.deepEqual(manifest.derivatives.map((item) => item.recipeId), [
    'thumbnail-small',
    'webp-master'
  ]);
  assert.equal(manifest.generatedAt, '2026-01-15T18:10:00.000Z');
});
