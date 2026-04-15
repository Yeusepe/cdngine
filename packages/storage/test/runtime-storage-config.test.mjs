/**
 * Purpose: Verifies that deployment-time environment variables resolve into one stable logical storage-role model for one-bucket and multi-bucket profiles.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/original-source-delivery.md
 * Tests:
 * - packages/storage/test/runtime-storage-config.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StorageRuntimeConfigError,
  loadStorageRuntimeConfigFromEnvironment
} from '../dist/runtime-storage-config.js';

test('loadStorageRuntimeConfigFromEnvironment resolves one-bucket profiles into distinct logical targets', () => {
  const config = loadStorageRuntimeConfigFromEnvironment({
    CDNGINE_DERIVED_PREFIX: 'published',
    CDNGINE_HOT_READ_LAYER: 'nydus',
    CDNGINE_SOURCE_DELIVERY_MODE: 'materialized-export',
    CDNGINE_STORAGE_BUCKET: 'cdngine-data',
    CDNGINE_STORAGE_LAYOUT_MODE: 'one-bucket',
    CDNGINE_TIERING_SUBSTRATE: 'seaweedfs'
  });

  assert.equal(config.layout.mode, 'one-bucket');
  assert.equal(config.normalized.ingest.targetKey, 'cdngine-data/ingest');
  assert.equal(config.normalized.derived.targetKey, 'cdngine-data/published');
  assert.deepEqual(config.defaults, {
    hotReadLayer: 'nydus',
    sourceDeliveryMode: 'materialized-export',
    tieringSubstrate: 'seaweedfs'
  });
});

test('loadStorageRuntimeConfigFromEnvironment resolves multi-bucket profiles with explicit buckets', () => {
  const config = loadStorageRuntimeConfigFromEnvironment({
    CDNGINE_DERIVED_BUCKET: 'cdngine-derived',
    CDNGINE_EXPORTS_BUCKET: 'cdngine-exports',
    CDNGINE_INGEST_BUCKET: 'cdngine-ingest',
    CDNGINE_SOURCE_BUCKET: 'cdngine-source',
    CDNGINE_STORAGE_LAYOUT_MODE: 'multi-bucket'
  });

  assert.equal(config.layout.mode, 'multi-bucket');
  assert.equal(config.normalized.source.targetKey, 'cdngine-source/source');
  assert.equal(config.normalized.exports.targetKey, 'cdngine-exports/exports');
  assert.deepEqual(config.defaults, {
    hotReadLayer: 'none',
    sourceDeliveryMode: 'proxy',
    tieringSubstrate: 'rustfs'
  });
});

test('loadStorageRuntimeConfigFromEnvironment rejects missing required bucket values', () => {
  assert.throws(
    () =>
      loadStorageRuntimeConfigFromEnvironment({
        CDNGINE_STORAGE_LAYOUT_MODE: 'multi-bucket'
      }),
    StorageRuntimeConfigError
  );
});
