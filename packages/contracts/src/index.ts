/**
 * Purpose: Exposes the contracts package entrypoint for code-near schema helpers and contract-build support.
 * Governing docs:
 * - docs/api-style-guide.md
 * - docs/spec-governance.md
 * - docs/sdk-strategy.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://spec.openapis.org/arazzo/latest.html
 * Tests:
 * - tests/conformance/README.md
 */

export const contractsPackageName = '@cdngine/contracts';
export * from './generated/public-api.js';
export * from './public-client.js';
