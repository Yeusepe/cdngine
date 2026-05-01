/**
 * Purpose: Verifies that the generic asset publication workflow preserves the canonical original as a deterministic published derivative and manifest, and keeps replayed runs stable.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/pipeline-capability-model.md
 * Tests:
 * - packages/workflows/test/generic-asset-publication-workflow.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryGenericAssetPublicationStore
} from '@cdngine/registry';

import {
  runGenericAssetPublicationWorkflow
} from '../dist/index.js';

class FakeDerivedObjectStore {
  constructor() {
    this.objects = new Map();
  }

  async publishObject(input) {
    const key = `derived/${input.objectKey}`;
    this.objects.set(input.objectKey, {
      bucket: 'cdngine-derived',
      key
    });

    return {
      bucket: 'cdngine-derived',
      key
    };
  }
}

class FakeGenericAssetProcessorActivity {
  constructor() {
    this.calls = [];
  }

  async processAssetDerivative(input) {
    this.calls.push(input);
    const body = JSON.stringify({
      canonicalSourceId: input.canonicalSourceEvidence.canonicalSourceId,
      recipeId: input.recipeBinding.recipeId
    });

    return {
      body,
      byteLength: BigInt(Buffer.byteLength(body)),
      checksum: {
        algorithm: 'sha256',
        value: 'preserved-sha'
      },
      contentType: input.sourceContentType
    };
  }
}

test('runGenericAssetPublicationWorkflow turns one canonical generic asset version into a deterministic preserve-original publication and manifest', async () => {
  const publicationStore = new InMemoryGenericAssetPublicationStore({
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
              value: 'source-sha'
            }
          ]
        },
        detectedContentType: 'application/octet-stream',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 2048n,
        sourceChecksumValue: 'source-sha',
        sourceFilename: 'archive.bin',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });
  const derivedObjectStore = new FakeDerivedObjectStore();
  const processorActivity = new FakeGenericAssetProcessorActivity();

  const result = await runGenericAssetPublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:45:00.000Z'),
      processorActivity,
      publicationStore
    }
  );

  const derivatives = await publicationStore.listPublishedDerivatives('ver_001');
  const manifest = await publicationStore.readManifest(
    'ver_001',
    'generic-asset-default',
    'scope_public'
  );

  assert.equal(result.version.lifecycleState, 'published');
  assert.deepEqual(
    derivatives.map((item) => item.deterministicKey),
    ['deriv/media-platform/ast_001/ver_001/preserve-original/preserve-original']
  );
  assert.equal(
    manifest?.objectKey,
    'derived/manifests/media-platform/ast_001/ver_001/generic-asset-default.json'
  );
  assert.equal(processorActivity.calls.length, 1);
});

test('runGenericAssetPublicationWorkflow keeps the preserve-original derivative key and manifest shape stable on replay', async () => {
  const publicationStore = new InMemoryGenericAssetPublicationStore({
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
              value: 'source-sha'
            }
          ]
        },
        detectedContentType: 'application/octet-stream',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 2048n,
        sourceChecksumValue: 'source-sha',
        sourceFilename: 'archive.bin',
        versionId: 'ver_001',
        versionNumber: 1
      }
    ]
  });
  const derivedObjectStore = new FakeDerivedObjectStore();
  const processorActivity = new FakeGenericAssetProcessorActivity();

  const first = await runGenericAssetPublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:45:00.000Z'),
      processorActivity,
      publicationStore
    }
  );
  const second = await runGenericAssetPublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:asset-derivation-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:46:00.000Z'),
      processorActivity,
      publicationStore
    }
  );

  assert.deepEqual(
    first.derivatives.map((item) => item.deterministicKey),
    second.derivatives.map((item) => item.deterministicKey)
  );
  assert.deepEqual(
    first.manifest.manifestPayload.preservedOriginal,
    second.manifest.manifestPayload.preservedOriginal
  );
  assert.equal((await publicationStore.listPublishedDerivatives('ver_001')).length, 1);
});
