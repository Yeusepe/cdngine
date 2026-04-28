/**
 * Purpose: Verifies that the presentation capability exposes deterministic recipe bindings and workflow-template resolution aligned to the presentation normalization slice.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/workflow-extensibility.md
 * Tests:
 * - packages/capabilities/test/presentation-capability.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultGenericCapability,
  defaultGenericRecipeBindings,
  defaultPresentationCapability,
  defaultPresentationProcessor,
  defaultPresentationRecipeBindings,
  resolveDefaultWorkflowTemplateForSource
} from '../dist/index.js';

test('default presentation capability exposes normalization and slide-image recipes', () => {
  assert.equal(defaultPresentationCapability.capabilityId, 'presentation.default');
  assert.deepEqual(defaultPresentationCapability.recipes, ['normalized-pdf', 'slide-images']);
  assert.deepEqual(defaultPresentationCapability.mimeTypes, [
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]);
});

test('presentation recipe bindings stay attached to the versioned presentation workflow template', () => {
  assert.deepEqual(
    defaultPresentationRecipeBindings.map((binding) => ({
      recipeId: binding.recipeId,
      variantKey: binding.variantKey,
      workflowTemplateId: binding.workflowTemplateId
    })),
    [
      {
        recipeId: 'normalized-pdf',
        variantKey: 'normalized-pdf',
        workflowTemplateId: 'presentation-normalization-v1'
      },
      {
        recipeId: 'slide-images',
        variantKey: 'slide-{pageNumber}',
        workflowTemplateId: 'presentation-normalization-v1'
      }
    ]
  );
  assert.equal(defaultPresentationProcessor.processorId, 'gotenberg-presentation-normalizer');
});

test('default workflow resolution chooses presentation normalization for document inputs', () => {
  assert.deepEqual(resolveDefaultWorkflowTemplateForSource('application/pdf'), {
    capabilityId: 'presentation.default',
    manifestType: 'presentation-default',
    workflowTemplateId: 'presentation-normalization-v1'
  });
  assert.deepEqual(resolveDefaultWorkflowTemplateForSource('image/png'), {
    capabilityId: 'image.default',
    manifestType: 'image-default',
    workflowTemplateId: 'image-derivation-v1'
  });
  assert.deepEqual(resolveDefaultWorkflowTemplateForSource('application/x-future-format'), {
    capabilityId: 'asset.generic',
    manifestType: 'generic-asset-default',
    workflowTemplateId: 'asset-derivation-v1'
  });
});

test('generic fallback capability preserves originals and only makes format-agnostic claims', () => {
  assert.equal(defaultGenericCapability.capabilityId, 'asset.generic');
  assert.equal(defaultGenericCapability.matchStrategy, 'fallback');
  assert.deepEqual(defaultGenericCapability.recipes, ['preserve-original']);
  assert.deepEqual(defaultGenericRecipeBindings, [
    {
      capabilityId: 'asset.generic',
      contentType: 'application/octet-stream',
      manifestType: 'generic-asset-default',
      recipeId: 'preserve-original',
      schemaVersion: 'v1',
      variantKey: 'preserve-original',
      workflowTemplateId: 'asset-derivation-v1'
    }
  ]);
  assert.deepEqual(defaultGenericCapability.normalization, {
    executionMode: 'post-canonicalization',
    supportedArtifacts: ['container-inventory'],
    fallback: {
      preserveOriginal: true,
      digestAlgorithms: ['sha256'],
      semanticClaims: 'none',
      containerInventory: {
        evidenceType: 'generic-container-inventory',
        mode: 'when-container-detected'
      }
    }
  });
});
