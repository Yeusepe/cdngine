/**
 * Purpose: Exposes the worker app entrypoint for workload-specific processor pools and Temporal activity hosts.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/temporal-message-contracts.md
 * - docs/environment-and-deployment.md
 * - docs/slo-and-capacity.md
 * External references:
 * - https://docs.temporal.io/develop/typescript
 * - https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning
 * Tests:
 * - tests/conformance/README.md
 */

export const workersAppName = '@cdngine/workers';
export * from './source-materialization.js';
