/**
 * Purpose: Verifies that storage-role normalization preserves distinct logical targets across one-bucket and multi-bucket layouts.
 * Governing docs:
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/original-source-delivery.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://github.com/rustfs/rustfs
 * - https://github.com/seaweedfs/seaweedfs
 * - https://kopia.io/docs/features/
 * Tests:
 * - packages/storage/test/storage-role-config.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { StorageTopologyError, normalizeStorageLayout, resolvePublicationTarget } from '../src/storage-role-config.ts';

test('normalizeStorageLayout keeps one-bucket role prefixes distinct', () => {
  const normalized = normalizeStorageLayout({
    mode: 'one-bucket',
    bucket: 'cdngine-data',
    prefixes: {
      ingest: '/ingest/',
      source: '/source/',
      derived: '/derived/',
      exports: '/exports/'
    }
  });

  assert.deepEqual(
    Object.fromEntries(Object.entries(normalized).map(([role, target]) => [role, target.targetKey])),
    {
      ingest: 'cdngine-data/ingest',
      source: 'cdngine-data/source',
      derived: 'cdngine-data/derived',
      exports: 'cdngine-data/exports'
    }
  );
});

test('normalizeStorageLayout accepts multi-bucket layouts with default prefixes', () => {
  const normalized = normalizeStorageLayout({
    mode: 'multi-bucket',
    buckets: {
      ingest: 'cdngine-ingest',
      source: 'cdngine-source',
      derived: 'cdngine-derived',
      exports: 'cdngine-exports'
    }
  });

  assert.equal(normalized.source.targetKey, 'cdngine-source/source');
  assert.equal(normalized.derived.targetKey, 'cdngine-derived/derived');
});

test('normalizeStorageLayout rejects overlapping logical targets', () => {
  assert.throws(
    () =>
      normalizeStorageLayout({
        mode: 'one-bucket',
        bucket: 'cdngine-data',
        prefixes: {
          ingest: 'ingest',
          source: 'shared',
          derived: 'shared',
          exports: 'exports'
        }
      }),
    StorageTopologyError
  );
});

test('resolvePublicationTarget distinguishes derivative publication from source-export publication', () => {
  const layout = {
    mode: 'one-bucket' as const,
    bucket: 'cdngine-data',
    prefixes: {
      ingest: 'ingest',
      source: 'source',
      derived: 'derived',
      exports: 'exports'
    }
  };

  assert.equal(resolvePublicationTarget(layout, 'derivative').role, 'derived');
  assert.equal(resolvePublicationTarget(layout, 'source-export').role, 'exports');
});
