/**
 * Purpose: Defines the generic fallback capability that keeps unknown formats valid through preserve-original plus optional container inventory evidence.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/workflow-extensibility.md
 * - docs/canonical-source-and-tiering-contract.md
 * External references:
 * - https://www.iana.org/assignments/media-types/application/octet-stream
 * - https://reproducible-builds.org/docs/archives/
 * Tests:
 * - packages/capabilities/test/presentation-capability.test.mjs
 */

import type {
  CapabilityRegistration,
  ProcessorRegistration
} from './capability-registration.js';
import { createFormatAgnosticNormalizationRegistration } from './normalization-contract.js';

export interface GenericAssetRecipeBinding {
  capabilityId: string;
  contentType: 'application/octet-stream';
  manifestType: 'generic-asset-default';
  recipeId: 'preserve-original';
  schemaVersion: string;
  variantKey: 'preserve-original';
  workflowTemplateId: 'asset-derivation-v1';
}

export const defaultGenericCapability: CapabilityRegistration = {
  capabilityId: 'asset.generic',
  extensions: [],
  keyTemplate: '/{serviceNamespaceId}/{assetId}/{versionId}/{recipeId}/{variantKey}',
  matchStrategy: 'fallback',
  mimeTypes: [],
  normalization: createFormatAgnosticNormalizationRegistration({
    containerInventoryMode: 'when-container-detected',
    supportedArtifacts: ['container-inventory']
  }),
  recipes: ['preserve-original'],
  resourceProfile: 'generic-light',
  retryPolicy: 'default-asset-retry',
  schemaVersion: 'v1',
  validators: ['sniff-generic-binary']
};

export const defaultGenericProcessor: ProcessorRegistration = {
  capabilities: ['asset.generic'],
  observabilityLabels: {
    processorFamily: 'generic-asset',
    processorRuntime: 'platform-default'
  },
  processorId: 'generic-asset-preserver',
  recipes: ['preserve-original'],
  retryPolicy: 'default-asset-retry',
  runtimeProfile: 'cpu-light',
  timeoutPolicy: 'asset-short-transform'
};

export const defaultGenericRecipeBindings: GenericAssetRecipeBinding[] = [
  {
    capabilityId: 'asset.generic',
    contentType: 'application/octet-stream',
    manifestType: 'generic-asset-default',
    recipeId: 'preserve-original',
    schemaVersion: 'v1',
    variantKey: 'preserve-original',
    workflowTemplateId: 'asset-derivation-v1'
  }
];

export function getGenericRecipeBinding(
  recipeId: GenericAssetRecipeBinding['recipeId']
): GenericAssetRecipeBinding {
  const binding = defaultGenericRecipeBindings.find((candidate) => candidate.recipeId === recipeId);

  if (!binding) {
    throw new Error(`Generic asset recipe "${recipeId}" is not registered.`);
  }

  return { ...binding };
}
