/**
 * Purpose: Verifies that the presentation publication workflow creates deterministic normalized-document and slide-image outputs, publishes a presentation manifest, and keeps replayed runs stable.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/pipeline-capability-model.md
 * Tests:
 * - packages/workflows/test/presentation-publication-workflow.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryPresentationPublicationStore
} from '@cdngine/registry';

import {
  runPresentationPublicationWorkflow
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

class FakePresentationProcessorActivity {
  constructor() {
    this.calls = [];
  }

  async processPresentation(input) {
    this.calls.push(input);
    const normalizedBody = JSON.stringify({
      canonicalSourceId: input.canonicalSourceId,
      variantKey: 'normalized-pdf'
    });
    const slideOneBody = JSON.stringify({
      canonicalSourceId: input.canonicalSourceId,
      variantKey: 'slide-001'
    });
    const slideTwoBody = JSON.stringify({
      canonicalSourceId: input.canonicalSourceId,
      variantKey: 'slide-002'
    });

    return {
      normalizedDocument: {
        body: normalizedBody,
        byteLength: BigInt(Buffer.byteLength(normalizedBody)),
        contentType: 'application/pdf'
      },
      slides: [
        {
          body: slideOneBody,
          byteLength: BigInt(Buffer.byteLength(slideOneBody)),
          contentType: 'image/webp',
          pageNumber: 1
        },
        {
          body: slideTwoBody,
          byteLength: BigInt(Buffer.byteLength(slideTwoBody)),
          contentType: 'image/webp',
          pageNumber: 2
        }
      ]
    };
  }
}

test('runPresentationPublicationWorkflow turns one canonical presentation version into deterministic published outputs and a manifest', async () => {
  const publicationStore = new InMemoryPresentationPublicationStore({
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
  const derivedObjectStore = new FakeDerivedObjectStore();
  const processorActivity = new FakePresentationProcessorActivity();

  const result = await runPresentationPublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:40:00.000Z'),
      processorActivity,
      publicationStore
    }
  );

  const derivatives = await publicationStore.listPublishedDerivatives('ver_001');
  const manifest = await publicationStore.readManifest('ver_001', 'presentation-default', 'scope_public');

  assert.equal(result.version.lifecycleState, 'published');
  assert.deepEqual(
    derivatives.map((item) => item.deterministicKey),
    [
      'deriv/media-platform/ast_001/ver_001/normalized-pdf/normalized-pdf',
      'deriv/media-platform/ast_001/ver_001/slide-images/slide-001',
      'deriv/media-platform/ast_001/ver_001/slide-images/slide-002'
    ]
  );
  assert.equal(manifest?.objectKey, 'derived/manifests/media-platform/ast_001/ver_001/presentation-default.json');
  assert.equal(processorActivity.calls.length, 1);
});

test('runPresentationPublicationWorkflow keeps derivative keys and manifest shape stable on replay', async () => {
  const publicationStore = new InMemoryPresentationPublicationStore({
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
  const derivedObjectStore = new FakeDerivedObjectStore();
  const processorActivity = new FakePresentationProcessorActivity();

  const first = await runPresentationPublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:40:00.000Z'),
      processorActivity,
      publicationStore
    }
  );
  const second = await runPresentationPublicationWorkflow(
    {
      deliveryScopeId: 'scope_public',
      versionId: 'ver_001',
      workflowId: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
    },
    {
      derivedObjectStore,
      now: () => new Date('2026-01-15T18:41:00.000Z'),
      processorActivity,
      publicationStore
    }
  );

  assert.deepEqual(
    first.derivatives.map((item) => item.deterministicKey),
    second.derivatives.map((item) => item.deterministicKey)
  );
  assert.deepEqual(first.manifest.manifestPayload.slides, second.manifest.manifestPayload.slides);
  assert.equal((await publicationStore.listPublishedDerivatives('ver_001')).length, 3);
});
