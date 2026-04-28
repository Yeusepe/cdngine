/**
 * Purpose: Exposes the capabilities package entrypoint for capability registration, recipe binding, and processor registration helpers.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/service-registration-model.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://github.com/medusajs/medusa
 * Tests:
 * - tests/conformance/README.md
 */

export const capabilitiesPackageName = '@cdngine/capabilities';
export * from './capability-registration.js';
export * from './generic-asset-capability.js';
export * from './image-capability.js';
export * from './normalization-contract.js';
export * from './presentation-capability.js';
export * from './workflow-template-resolution.js';
