/**
 * Purpose: Verifies deterministic presentation manifest generation and stable ordering for normalized documents and slide-image outputs.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/versioning-and-compatibility.md
 * - docs/workload-and-recipe-matrix.md
 * Tests:
 * - packages/manifests/test/presentation-manifest.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeterministicDerivativeKey,
  buildManifestObjectKey,
  buildPresentationAssetManifest
} from '../dist/index.js';

test('presentation manifest object keys stay stable for normalized pdf and slide publication', () => {
  assert.equal(
    buildDeterministicDerivativeKey({
      assetId: 'ast_001',
      recipeId: 'normalized-pdf',
      serviceNamespaceId: 'media-platform',
      variantKey: 'normalized-pdf',
      versionId: 'ver_001'
    }),
    'deriv/media-platform/ast_001/ver_001/normalized-pdf/normalized-pdf'
  );
  assert.equal(
    buildManifestObjectKey({
      assetId: 'ast_001',
      manifestType: 'presentation-default',
      serviceNamespaceId: 'media-platform',
      versionId: 'ver_001'
    }),
    'manifests/media-platform/ast_001/ver_001/presentation-default.json'
  );
});

test('presentation manifests sort slide outputs by page number so replay stays stable', () => {
  const manifest = buildPresentationAssetManifest({
    assetId: 'ast_001',
    generatedAt: new Date('2026-01-15T18:30:00.000Z'),
    manifestType: 'presentation-default',
    normalizedDocument: {
      byteLength: 1024n,
      checksum: 'pdf-sha',
      contentType: 'application/pdf',
      deterministicKey: 'deriv/media-platform/ast_001/ver_001/normalized-pdf/normalized-pdf',
      recipeId: 'normalized-pdf',
      schemaVersion: 'v1',
      variantKey: 'normalized-pdf'
    },
    schemaVersion: 'v1',
    serviceNamespaceId: 'media-platform',
    slides: [
      {
        byteLength: 256n,
        checksum: 'slide-2',
        contentType: 'image/webp',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/slide-images/slide-002',
        pageNumber: 2,
        recipeId: 'slide-images',
        schemaVersion: 'v1',
        variantKey: 'slide-002'
      },
      {
        byteLength: 255n,
        checksum: 'slide-1',
        contentType: 'image/webp',
        deterministicKey: 'deriv/media-platform/ast_001/ver_001/slide-images/slide-001',
        pageNumber: 1,
        recipeId: 'slide-images',
        schemaVersion: 'v1',
        variantKey: 'slide-001'
      }
    ],
    versionId: 'ver_001'
  });

  assert.equal(manifest.normalizedDocument.variantKey, 'normalized-pdf');
  assert.deepEqual(manifest.slides.map((slide) => slide.pageNumber), [1, 2]);
  assert.equal(manifest.generatedAt, '2026-01-15T18:30:00.000Z');
});
