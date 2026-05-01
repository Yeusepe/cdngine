/**
 * Purpose: Exposes the manifests package entrypoint for manifest builders, parsers, and publication helpers.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/versioning-and-compatibility.md
 * - docs/adr/0003-deterministic-derivative-keys.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://semver.org/
 * Tests:
 * - tests/conformance/README.md
 */

export const manifestsPackageName = '@cdngine/manifests';
export * from './deterministic-derivative-keys.js';
export * from './generic-asset-manifest.js';
export * from './image-manifest.js';
export * from './presentation-manifest.js';
