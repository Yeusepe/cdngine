/**
 * Purpose: Verifies deterministic manifest generation for generic preserve-original publication and stable replay-safe object keys.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/workflow-extensibility.md
 * - docs/workload-and-recipe-matrix.md
 * Tests:
 * - packages/manifests/test/generic-asset-manifest.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeterministicDerivativeKey,
  buildManifestObjectKey,
  buildGenericAssetManifest
} from '../dist/index.js';

test('generic asset manifest object keys stay stable for preserve-original publication', () => {
  assert.equal(
    buildDeterministicDerivativeKey({
      assetId: 'ast_001',
      recipeId: 'preserve-original',
      serviceNamespaceId: 'media-platform',
      variantKey: 'preserve-original',
      versionId: 'ver_001'
    }),
    'deriv/media-platform/ast_001/ver_001/preserve-original/preserve-original'
  );
  assert.equal(
    buildManifestObjectKey({
      assetId: 'ast_001',
      manifestType: 'generic-asset-default',
      serviceNamespaceId: 'media-platform',
      versionId: 'ver_001'
    }),
    'manifests/media-platform/ast_001/ver_001/generic-asset-default.json'
  );
});

test('generic asset manifests preserve the published original descriptor deterministically', () => {
  const manifest = buildGenericAssetManifest({
    assetId: 'ast_001',
    generatedAt: new Date('2026-01-15T18:45:00.000Z'),
    manifestType: 'generic-asset-default',
    preservedOriginal: {
      byteLength: 2048n,
      checksum: 'original-sha',
      contentType: 'application/octet-stream',
      deterministicKey: 'deriv/media-platform/ast_001/ver_001/preserve-original/preserve-original',
      recipeId: 'preserve-original',
      schemaVersion: 'v1',
      variantKey: 'preserve-original'
    },
    schemaVersion: 'v1',
    serviceNamespaceId: 'media-platform',
    versionId: 'ver_001'
  });

  assert.equal(manifest.generatedAt, '2026-01-15T18:45:00.000Z');
  assert.equal(manifest.preservedOriginal.variantKey, 'preserve-original');
  assert.equal(manifest.preservedOriginal.byteLength, 2048);
});
