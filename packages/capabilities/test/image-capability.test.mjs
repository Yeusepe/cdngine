/**
 * Purpose: Verifies that the initial image capability exposes deterministic recipe bindings and a processor registration aligned to the first image workflow template.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/workload-and-recipe-matrix.md
 * Tests:
 * - packages/capabilities/test/image-capability.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultImageCapability,
  defaultImageProcessor,
  defaultImageRecipeBindings,
  getImageRecipeBinding
} from '../dist/image-capability.js';

test('default image capability exposes the expected recipes and MIME types', () => {
  assert.equal(defaultImageCapability.capabilityId, 'image.default');
  assert.deepEqual(defaultImageCapability.mimeTypes, ['image/png', 'image/jpeg', 'image/webp']);
  assert.deepEqual(defaultImageCapability.recipes, ['webp-master', 'thumbnail-small']);
});

test('image recipe bindings stay attached to the versioned image workflow template', () => {
  assert.deepEqual(
    defaultImageRecipeBindings.map((binding) => binding.workflowTemplateId),
    ['image-derivation-v1', 'image-derivation-v1']
  );
  assert.deepEqual(
    defaultImageRecipeBindings.map((binding) => binding.recipeId),
    ['webp-master', 'thumbnail-small']
  );
});

test('getImageRecipeBinding resolves stable recipe registrations', () => {
  const binding = getImageRecipeBinding('thumbnail-small');

  assert.deepEqual(binding, {
    capabilityId: 'image.default',
    contentType: 'image/webp',
    manifestType: 'image-default',
    recipeId: 'thumbnail-small',
    schemaVersion: 'v1',
    variantKey: 'thumbnail-small',
    workflowTemplateId: 'image-derivation-v1'
  });
  assert.equal(defaultImageProcessor.processorId, 'imgproxy-image-deriver');
});
