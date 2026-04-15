/**
 * Purpose: Creates the shared Hono app shell for public, platform-admin, and operator surfaces with one middleware, auth, timeout, and problem-response posture.
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
 * - https://opentelemetry.io/docs/languages/js/
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

import { Hono } from 'hono';

import { assertAuthorizedScope, authenticationMiddleware } from './auth.js';
import type { ApiEnv, ApiSurface, SurfaceRouteRegistrar } from './api-types.js';
import { createProblemResponse, mapUnknownErrorToProblem, problemTypes } from './problem-details.js';
import { requestContextMiddleware } from './request-context.js';

export interface CreateApiAppOptions {
  registerOperatorRoutes?: SurfaceRouteRegistrar;
  registerPlatformAdminRoutes?: SurfaceRouteRegistrar;
  registerPublicRoutes?: SurfaceRouteRegistrar;
  requestTimeoutMs?: number;
}

function createSurfaceApp(surface: ApiSurface, registerRoutes?: SurfaceRouteRegistrar) {
  const surfaceApp = new Hono<ApiEnv>();

  surfaceApp.use('*', authenticationMiddleware(surface));
  registerRoutes?.(surfaceApp);
  surfaceApp.notFound((context) =>
    createProblemResponse(context, {
      type: problemTypes.notFound,
      title: 'Not found',
      status: 404,
      detail: `No ${surface} route matched ${context.req.path}.`,
      retryable: false
    })
  );

  return surfaceApp;
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = new Hono<ApiEnv>();

  app.use('*', requestContextMiddleware({ timeoutMs: options.requestTimeoutMs ?? 5_000 }));

  app.get('/healthz', (context) =>
    context.json({
      status: 'ok',
      requestId: context.get('requestId')
    })
  );

  app.get('/readyz', (context) =>
    context.json({
      status: 'ready',
      requestId: context.get('requestId')
    })
  );

  app.route('/v1', createSurfaceApp('public', options.registerPublicRoutes));
  app.route('/v1/platform', createSurfaceApp('platform-admin', options.registerPlatformAdminRoutes));
  app.route('/v1/operator', createSurfaceApp('operator', options.registerOperatorRoutes));

  app.notFound((context) =>
    createProblemResponse(context, {
      type: problemTypes.notFound,
      title: 'Not found',
      status: 404,
      detail: `No API route matched ${context.req.path}.`,
      retryable: false
    })
  );

  app.onError((error, context) => createProblemResponse(context, mapUnknownErrorToProblem(error)));

  return app;
}

export function requireRequestedScope(context: {
  get: <TKey extends keyof ApiEnv['Variables']>(key: TKey) => ApiEnv['Variables'][TKey];
}) {
  const requestedScope = context.get('requestedScope');
  assertAuthorizedScope(context, requestedScope);
  return requestedScope;
}
