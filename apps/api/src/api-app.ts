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
import type { RequestActorAuthenticator } from '@cdngine/auth';
import {
  InMemoryApiObservability,
  type ApiObservability,
  type RuntimeReadinessMonitor,
  type RuntimeReadinessReport
} from '@cdngine/observability';

import { assertAuthorizedScope, authenticationMiddleware } from './auth.js';
import type { ApiEnv, ApiSurface, SurfaceRouteRegistrar } from './api-types.js';
import { createProblemResponse, mapUnknownErrorToProblem, problemTypes } from './problem-details.js';
import { requestContextMiddleware } from './request-context.js';

export interface CreateApiAppOptions {
  auth?: RequestActorAuthenticator;
  readiness?: RuntimeReadinessMonitor;
  registerCapabilityRoutes?: SurfaceRouteRegistrar;
  registerOperatorRoutes?: SurfaceRouteRegistrar;
  registerPlatformAdminRoutes?: SurfaceRouteRegistrar;
  registerPublicRoutes?: SurfaceRouteRegistrar;
  requestTimeoutMs?: number;
  serviceName?: string;
  serviceVersion?: string;
  telemetry?: ApiObservability;
}

const defaultApiServiceName = '@cdngine/api';

function createDefaultReadinessReport(): RuntimeReadinessReport {
  return {
    checkedAt: new Date(),
    degradedBoundaries: [],
    dependencies: [],
    deploymentProfile: 'local-fast-start',
    failedBoundaries: [],
    status: 'ready'
  };
}

function createSurfaceApp(
  surface: ApiSurface,
  registerRoutes?: SurfaceRouteRegistrar,
  authenticator?: RequestActorAuthenticator
) {
  const surfaceApp = new Hono<ApiEnv>();

  surfaceApp.use('*', authenticationMiddleware(surface, authenticator));
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
  const serviceName = options.serviceName?.trim() || defaultApiServiceName;
  const serviceVersion = options.serviceVersion?.trim() || process.env.npm_package_version || '0.1.0';
  const telemetry = options.telemetry ?? new InMemoryApiObservability({ service: serviceName });
  const bootedAt = new Date();

  app.use('*', requestContextMiddleware({ timeoutMs: options.requestTimeoutMs ?? 5_000 }));
  app.use('*', async (context, next) => {
    let mappedProblem:
      | ReturnType<typeof mapUnknownErrorToProblem>
      | undefined;

    try {
      await next();
    } catch (error) {
      mappedProblem = mapUnknownErrorToProblem(error);
      throw error;
    } finally {
      const actorSubject = context.get('actor')?.subject;
      const correlation = context.get('correlation');

      await telemetry.recordRequest({
        durationMs: Date.now() - context.get('requestStartedAt').getTime(),
        method: context.req.method.toUpperCase(),
        path: context.req.path,
        requestId: context.get('requestId'),
        requestStartedAt: context.get('requestStartedAt'),
        service: serviceName,
        statusCode: context.res?.status ?? mappedProblem?.status ?? 500,
        surface: context.get('surface') ?? 'system',
        traceId: context.get('trace').traceId,
        ...(actorSubject ? { actorSubject } : {}),
        ...(correlation.assetId ? { assetId: correlation.assetId } : {}),
        ...(correlation.serviceNamespaceId
          ? { serviceNamespaceId: correlation.serviceNamespaceId }
          : {}),
        ...(correlation.tenantId ? { tenantId: correlation.tenantId } : {}),
        ...(correlation.versionId ? { versionId: correlation.versionId } : {}),
        ...(correlation.workflowId ? { workflowId: correlation.workflowId } : {})
      });
    }
  });

  app.get('/healthz', (context) =>
    context.json(
      {
        requestId: context.get('requestId'),
        service: serviceName,
        status: 'ok',
        traceId: context.get('trace').traceId,
        uptimeSeconds: Math.max(0, Math.round((Date.now() - bootedAt.getTime()) / 1_000)),
        version: serviceVersion
      },
      200,
      {
        'cache-control': 'no-store'
      }
    )
  );

  app.get('/readyz', async (context) => {
    const report = options.readiness ? await options.readiness.check() : createDefaultReadinessReport();

    telemetry.recordReadiness(report);
    return context.json(
      {
        checkedAt: report.checkedAt.toISOString(),
        degradedBoundaries: report.degradedBoundaries,
        dependencies: report.dependencies.map((dependency) => ({
          ...dependency,
          checkedAt: dependency.checkedAt.toISOString()
        })),
        deploymentProfile: report.deploymentProfile,
        failedBoundaries: report.failedBoundaries,
        requestId: context.get('requestId'),
        service: serviceName,
        status: report.status,
        traceId: context.get('trace').traceId
      },
      report.status === 'not-ready' ? 503 : 200,
      {
        'cache-control': 'no-store'
      }
    );
  });

  app.get('/metrics', () =>
    new Response(telemetry.renderPrometheus(), {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; version=0.0.4; charset=utf-8'
      },
      status: 200
    })
  );

  options.registerCapabilityRoutes?.(app);
  app.route('/v1', createSurfaceApp('public', options.registerPublicRoutes, options.auth));
  app.route(
    '/v1/platform',
    createSurfaceApp('platform-admin', options.registerPlatformAdminRoutes, options.auth)
  );
  app.route('/v1/operator', createSurfaceApp('operator', options.registerOperatorRoutes, options.auth));

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
