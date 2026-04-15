/**
 * Purpose: Defines the first image capability, processor registration, and recipe bindings used by the initial image vertical slice.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/workflow-extensibility.md
 * External references:
 * - https://github.com/imgproxy/imgproxy
 * - https://github.com/libvips/libvips
 * Tests:
 * - packages/capabilities/test/image-capability.test.mjs
 */

import type {
  CapabilityRegistration,
  ProcessorRegistration
} from './capability-registration.js';

export type { CapabilityRegistration, ProcessorRegistration } from './capability-registration.js';

export interface ImageRecipeBinding {
  capabilityId: string;
  contentType: string;
  manifestType: 'image-default';
  recipeId: string;
  schemaVersion: string;
  variantKey: string;
  workflowTemplateId: 'image-derivation-v1';
}

export const defaultImageCapability: CapabilityRegistration = {
  capabilityId: 'image.default',
  extensions: ['.png', '.jpg', '.jpeg', '.webp'],
  keyTemplate: '/{serviceNamespaceId}/{assetId}/{versionId}/{recipeId}/{variantKey}',
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  recipes: ['webp-master', 'thumbnail-small'],
  resourceProfile: 'image-medium',
  retryPolicy: 'default-media-retry',
  schemaVersion: 'v1',
  validators: ['sniff-image']
};

export const defaultImageProcessor: ProcessorRegistration = {
  capabilities: ['image.default'],
  observabilityLabels: {
    processorFamily: 'image',
    processorRuntime: 'imgproxy-libvips'
  },
  processorId: 'imgproxy-image-deriver',
  recipes: ['webp-master', 'thumbnail-small'],
  retryPolicy: 'default-media-retry',
  runtimeProfile: 'cpu-image',
  timeoutPolicy: 'image-short-transform'
};

export const defaultImageRecipeBindings: ImageRecipeBinding[] = [
  {
    capabilityId: 'image.default',
    contentType: 'image/webp',
    manifestType: 'image-default',
    recipeId: 'webp-master',
    schemaVersion: 'v1',
    variantKey: 'webp-master',
    workflowTemplateId: 'image-derivation-v1'
  },
  {
    capabilityId: 'image.default',
    contentType: 'image/webp',
    manifestType: 'image-default',
    recipeId: 'thumbnail-small',
    schemaVersion: 'v1',
    variantKey: 'thumbnail-small',
    workflowTemplateId: 'image-derivation-v1'
  }
];

export function getImageRecipeBinding(recipeId: string): ImageRecipeBinding {
  const binding = defaultImageRecipeBindings.find((candidate) => candidate.recipeId === recipeId);

  if (!binding) {
    throw new Error(`Image recipe "${recipeId}" is not registered.`);
  }

  return { ...binding };
}
