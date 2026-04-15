/**
 * Purpose: Provides shared request ID, timeout, and correlation middleware for all API surfaces.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/security-model.md
 * - docs/observability.md
 * External references:
 * - https://hono.dev/docs
 * - https://opentelemetry.io/docs/languages/js/
 * - https://www.w3.org/TR/trace-context/
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

import type { MiddlewareHandler } from 'hono';

import type { ApiEnv, RequestCorrelation, RequestedScope } from './api-types.js';
import { ProblemDetailError, problemTypes } from './problem-details.js';

export interface RequestContextOptions {
  timeoutMs: number;
}

function readHeader(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function createRequestedScope(
  serviceNamespaceId: string | undefined,
  tenantId: string | undefined
): RequestedScope {
  const scope: RequestedScope = {};

  if (serviceNamespaceId) {
    scope.serviceNamespaceId = serviceNamespaceId;
  }

  if (tenantId) {
    scope.tenantId = tenantId;
  }

  return scope;
}

function createCorrelation(
  requestId: string,
  serviceNamespaceId: string | undefined,
  tenantId: string | undefined,
  assetId: string | undefined,
  versionId: string | undefined,
  workflowId: string | undefined
): RequestCorrelation {
  const correlation: RequestCorrelation = {
    requestId
  };

  if (serviceNamespaceId) {
    correlation.serviceNamespaceId = serviceNamespaceId;
  }

  if (tenantId) {
    correlation.tenantId = tenantId;
  }

  if (assetId) {
    correlation.assetId = assetId;
  }

  if (versionId) {
    correlation.versionId = versionId;
  }

  if (workflowId) {
    correlation.workflowId = workflowId;
  }

  return correlation;
}

export function requestContextMiddleware(options: RequestContextOptions): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const requestId = readHeader(context.req.header('x-request-id')) ?? crypto.randomUUID();
    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + options.timeoutMs);
    const controller = new AbortController();
    const serviceNamespaceId = readHeader(context.req.header('x-cdngine-service-namespace'));
    const tenantId = readHeader(context.req.header('x-cdngine-tenant-id'));
    const assetId = readHeader(context.req.header('x-cdngine-asset-id'));
    const versionId = readHeader(context.req.header('x-cdngine-version-id'));
    const workflowId = readHeader(context.req.header('x-cdngine-workflow-id'));

    context.set('requestId', requestId);
    context.set('requestStartedAt', startedAt);
    context.set('requestDeadlineAt', deadlineAt);
    context.set('requestSignal', controller.signal);
    const requestedScope = createRequestedScope(serviceNamespaceId, tenantId);
    const correlation = createCorrelation(
      requestId,
      serviceNamespaceId,
      tenantId,
      assetId,
      versionId,
      workflowId
    );

    context.set('requestedScope', requestedScope);
    context.set('correlation', correlation);
    context.header('x-request-id', requestId);

    let timeoutId: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        next(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort('request-timeout');
            reject(
              new ProblemDetailError({
                type: problemTypes.upstreamDependencyFailed,
                title: 'Request timed out',
                status: 503,
                detail: `The request exceeded the configured timeout of ${options.timeoutMs}ms.`,
                retryable: true
              })
            );
          }, options.timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };
}

export function getRequestLogContext(context: {
  get: <TKey extends keyof ApiEnv['Variables']>(key: TKey) => ApiEnv['Variables'][TKey];
}) {
  return {
    ...context.get('correlation'),
    surface: context.get('surface')
  };
}
