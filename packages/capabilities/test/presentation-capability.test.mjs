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
});
