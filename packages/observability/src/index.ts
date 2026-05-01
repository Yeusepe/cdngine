/**
 * Purpose: Exposes the observability package entrypoint for tracing, logging, metrics, and correlation helpers.
 * Governing docs:
 * - docs/observability.md
 * - docs/slo-and-capacity.md
 * - docs/traceability.md
 * External references:
 * - https://opentelemetry.io/docs/languages/js/
 * - https://prometheus.io/docs/instrumenting/
 * Tests:
 * - tests/conformance/README.md
 */

export const observabilityPackageName = '@cdngine/observability';
export * from './asset-lineage.js';
export * from './readiness-profile.js';
export * from './readiness.js';
export * from './runtime-observability.js';
export * from './runtime-readiness.js';
export * from './trace-context.js';
