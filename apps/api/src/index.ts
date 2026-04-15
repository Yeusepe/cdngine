/**
 * Purpose: Exposes the API app entrypoint for the Hono-based public, admin, and internal HTTP surfaces.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * - docs/api-style-guide.md
 * - docs/problem-types.md
 * - docs/security-model.md
 * - docs/observability.md
 * External references:
 * - https://hono.dev/docs
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * - https://zod.dev/
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

export const apiAppName = '@cdngine/api';
export * from './api-app.js';
export * from './auth.js';
export * from './operator/operator-routes.js';
export * from './operator/operator-service.js';
export * from './problem-details.js';
export * from './public/delivery-routes.js';
export * from './public/delivery-service.js';
export * from './public/upload-session-routes.js';
export * from './request-context.js';
export * from './upload-session-service.js';
export * from './validation.js';
