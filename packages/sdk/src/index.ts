/**
 * Purpose: Exposes the SDK package entrypoint for the public CDNgine client and generated API types.
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

export const sdkPackageName = '@cdngine/sdk';
export * from './generated/public-api.js';
export * from './public-client.js';
