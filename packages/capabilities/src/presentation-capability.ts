/**
 * Purpose: Defines the presentation capability, processor registration, and recipe bindings used by the presentation normalization slice.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/workflow-extensibility.md
 * External references:
 * - https://github.com/gotenberg/gotenberg
 * Tests:
 * - packages/capabilities/test/presentation-capability.test.mjs
 */

import type {
  CapabilityRegistration,
  ProcessorRegistration
} from './capability-registration.js';

export interface PresentationRecipeBinding {
  capabilityId: string;
  contentType: string;
  manifestType: 'presentation-default';
  recipeId: 'normalized-pdf' | 'slide-images';
  schemaVersion: string;
  variantKey: 'normalized-pdf' | 'slide-{pageNumber}';
  workflowTemplateId: 'presentation-normalization-v1';
}

export const defaultPresentationCapability: CapabilityRegistration = {
  capabilityId: 'presentation.default',
  extensions: ['.pdf', '.ppt', '.pptx'],
  keyTemplate: '/{serviceNamespaceId}/{assetId}/{versionId}/{recipeId}/{variantKey}',
  mimeTypes: [
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ],
  recipes: ['normalized-pdf', 'slide-images'],
  resourceProfile: 'document-medium',
  retryPolicy: 'default-document-retry',
  schemaVersion: 'v1',
  validators: ['sniff-document']
};

export const defaultPresentationProcessor: ProcessorRegistration = {
  capabilities: ['presentation.default'],
  observabilityLabels: {
    processorFamily: 'presentation',
    processorRuntime: 'gotenberg'
  },
  processorId: 'gotenberg-presentation-normalizer',
  recipes: ['normalized-pdf', 'slide-images'],
  retryPolicy: 'default-document-retry',
  runtimeProfile: 'cpu-document',
  timeoutPolicy: 'document-normalization'
};

export const defaultPresentationRecipeBindings: PresentationRecipeBinding[] = [
  {
    capabilityId: 'presentation.default',
    contentType: 'application/pdf',
    manifestType: 'presentation-default',
    recipeId: 'normalized-pdf',
    schemaVersion: 'v1',
    variantKey: 'normalized-pdf',
    workflowTemplateId: 'presentation-normalization-v1'
  },
  {
    capabilityId: 'presentation.default',
    contentType: 'image/webp',
    manifestType: 'presentation-default',
    recipeId: 'slide-images',
    schemaVersion: 'v1',
    variantKey: 'slide-{pageNumber}',
    workflowTemplateId: 'presentation-normalization-v1'
  }
];

export function getPresentationRecipeBinding(recipeId: PresentationRecipeBinding['recipeId']): PresentationRecipeBinding {
  const binding = defaultPresentationRecipeBindings.find((candidate) => candidate.recipeId === recipeId);

  if (!binding) {
    throw new Error(`Presentation recipe "${recipeId}" is not registered.`);
  }

  return { ...binding };
}
