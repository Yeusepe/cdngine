/**
 * Purpose: Exposes the operator app entrypoint for replay, quarantine, diagnostics, and other trusted control flows.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/security-model.md
 * - docs/runbooks/README.md
 * - docs/threat-models/README.md
 * External references:
 * - https://hono.dev/docs
 * - https://docs.temporal.io/develop/typescript
 * Tests:
 * - tests/conformance/README.md
 */

export const operatorAppName = '@cdngine/operator';
export * from './operator-app.js';
