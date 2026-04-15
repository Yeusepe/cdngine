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

import { defaultImageCapability, defaultImageRecipeBindings } from './image-capability.js';
import { defaultPresentationCapability, defaultPresentationRecipeBindings } from './presentation-capability.js';

export interface ResolvedWorkflowTemplate {
  capabilityId: string;
  manifestType: string;
  workflowTemplateId: string;
}

const defaultWorkflowBindings: Array<ResolvedWorkflowTemplate & { mimeTypes: readonly string[] }> = [
  {
    capabilityId: defaultImageCapability.capabilityId,
    manifestType: defaultImageRecipeBindings[0].manifestType,
    mimeTypes: defaultImageCapability.mimeTypes,
    workflowTemplateId: defaultImageRecipeBindings[0].workflowTemplateId
  },
  {
    capabilityId: defaultPresentationCapability.capabilityId,
    manifestType: defaultPresentationRecipeBindings[0].manifestType,
    mimeTypes: defaultPresentationCapability.mimeTypes,
    workflowTemplateId: defaultPresentationRecipeBindings[0].workflowTemplateId
  }
];

export function resolveDefaultWorkflowTemplateForSource(
  contentType: string
): ResolvedWorkflowTemplate | null {
  const normalizedContentType = contentType.trim().toLowerCase();
  const binding = defaultWorkflowBindings.find((candidate) =>
    candidate.mimeTypes.some((mimeType) => mimeType.toLowerCase() === normalizedContentType)
  );

  return binding
    ? {
        capabilityId: binding.capabilityId,
        manifestType: binding.manifestType,
        workflowTemplateId: binding.workflowTemplateId
      }
    : null;
}
