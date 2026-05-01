/**
 * Purpose: Exposes the workflows package entrypoint for replay-safe workflow definitions, activity contracts, and message types.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/temporal-message-contracts.md
 * - docs/versioning-and-compatibility.md
 * External references:
 * - https://docs.temporal.io/develop/typescript
 * - https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning
 * Tests:
 * - tests/conformance/README.md
 */

export const workflowsPackageName = '@cdngine/workflows';
export * from './dispatch-runtime.js';
export * from './generic-asset-publication-workflow.js';
export * from './image-publication-workflow.js';
export * from './output-workflow-templates.js';
export * from './presentation-publication-workflow.js';
export * from './temporal-workflow-client.js';
export * from './workflow-registry.js';
export * from './workflow-templates.js';
