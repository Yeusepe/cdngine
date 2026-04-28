/**
 * Purpose: Resolves the default workflow template and manifest family for known source content types using capability registrations rather than route-local branching.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/workflow-extensibility.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://www.iana.org/assignments/media-types/media-types.xhtml
 * Tests:
 * - packages/capabilities/test/presentation-capability.test.mjs
 */

import {
  defaultGenericCapability,
  getGenericRecipeBinding
} from './generic-asset-capability.js';
import {
  defaultImageCapability,
  getImageRecipeBinding
} from './image-capability.js';
import {
  defaultPresentationCapability,
  getPresentationRecipeBinding
} from './presentation-capability.js';

export interface ResolvedWorkflowTemplate {
  capabilityId: string;
  manifestType: string;
  workflowTemplateId: string;
}

const defaultWorkflowBindings: Array<ResolvedWorkflowTemplate & { mimeTypes: readonly string[] }> = [
  {
    capabilityId: defaultImageCapability.capabilityId,
    manifestType: getImageRecipeBinding('webp-master').manifestType,
    mimeTypes: defaultImageCapability.mimeTypes,
    workflowTemplateId: getImageRecipeBinding('webp-master').workflowTemplateId
  },
  {
    capabilityId: defaultPresentationCapability.capabilityId,
    manifestType: getPresentationRecipeBinding('normalized-pdf').manifestType,
    mimeTypes: defaultPresentationCapability.mimeTypes,
    workflowTemplateId: getPresentationRecipeBinding('normalized-pdf').workflowTemplateId
  },
  {
    capabilityId: defaultGenericCapability.capabilityId,
    manifestType: getGenericRecipeBinding('preserve-original').manifestType,
    mimeTypes: defaultGenericCapability.mimeTypes,
    workflowTemplateId: getGenericRecipeBinding('preserve-original').workflowTemplateId
  }
];

export function resolveDefaultWorkflowTemplateForSource(
  contentType: string
): ResolvedWorkflowTemplate | null {
  const normalizedContentType = contentType.trim().toLowerCase();
  const binding = defaultWorkflowBindings.find((candidate) =>
    candidate.mimeTypes.some((mimeType) => mimeType.toLowerCase() === normalizedContentType)
  );

  const fallbackBinding = defaultWorkflowBindings.find(
    (candidate) => candidate.capabilityId === defaultGenericCapability.capabilityId
  );
  const resolvedBinding = binding ?? fallbackBinding;

  return resolvedBinding
    ? {
        capabilityId: resolvedBinding.capabilityId,
        manifestType: resolvedBinding.manifestType,
        workflowTemplateId: resolvedBinding.workflowTemplateId
      }
    : null;
}
