/**
 * Purpose: Verifies that the shared Hono app shell enforces one request-context, auth, scope, timeout, and problem-response posture across API surfaces.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * - docs/problem-types.md
 * - docs/security-model.md
 * - docs/observability.md
 * External references:
 * - https://hono.dev/docs
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * - https://zod.dev/
 * Tests:
 * - apps/api/test/api-app.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';
import {
  InMemoryApiObservability,
  RuntimeReadinessMonitor
} from '@cdngine/observability';

import { createApiApp, requireRequestedScope } from '../dist/api-app.js';
import { getRequestLogContext } from '../dist/request-context.js';
import { validateJsonBody } from '../dist/validation.js';
import {
  createAuthFixture,
  createJsonBearerHeaders,
  provisionPublicActor
} from '../../../tests/auth-fixture.mjs';

test('health endpoint is unprotected and returns a request id', async () => {
  const app = createApiApp();
  const response = await app.request('http://localhost/healthz');
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
  assert.equal(typeof payload.requestId, 'string');
  assert.equal(response.headers.get('x-request-id'), payload.requestId);
});

test('public surface requires bearer authentication and returns RFC 9457 problems', async () => {
  const app = createApiApp({
    registerPublicRoutes(publicApp) {
      publicApp.get('/probe', (context) =>
        context.json({
          requestId: context.get('requestId')
        })
      );
    }
  });

  const response = await app.request('http://localhost/v1/probe');
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/unauthorized');
  assert.equal(payload.retryable, false);
});

test('operator surface rejects callers without operator role', async () => {
  const auth = createAuthFixture();
  const publicActor = await provisionPublicActor(auth);
  const app = createApiApp({
    auth,
    registerOperatorRoutes(operatorApp) {
      operatorApp.get('/diagnostics', (context) =>
        context.json({
          requestId: context.get('requestId')
        })
      );
    }
  });

  const response = await app.request('http://localhost/v1/operator/diagnostics', {
    headers: createJsonBearerHeaders(publicActor.token)
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/forbidden');
});

test('validation middleware and scope enforcement share the same problem posture', async () => {
  const auth = createAuthFixture();
  const publicActor = await provisionPublicActor(auth, {
    allowedServiceNamespaces: ['creative-services']
  });
  const app = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      publicApp.post(
        '/upload-sessions',
        validateJsonBody(
          z.object({
            serviceNamespaceId: z.string().min(1),
            tenantId: z.string().min(1).optional()
          })
        ),
        (context) => {
          const validated = context.get('validatedBody');

          context.set('requestedScope', {
            serviceNamespaceId: validated.serviceNamespaceId,
            ...(validated.tenantId ? { tenantId: validated.tenantId } : {})
          });

          const requestedScope = requireRequestedScope(context);
          const logContext = getRequestLogContext(context);

          return context.json({
            requestedScope,
            requestId: logContext.requestId,
            surface: logContext.surface
          });
        }
      );
    }
  });

  const invalidResponse = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createJsonBearerHeaders(publicActor.token),
    body: JSON.stringify({})
  });
  const invalidPayload = await invalidResponse.json();

  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.type, 'https://docs.cdngine.dev/problems/invalid-request');

  const forbiddenResponse = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createJsonBearerHeaders(publicActor.token),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform'
    })
  });
  const forbiddenPayload = await forbiddenResponse.json();

  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbiddenPayload.type, 'https://docs.cdngine.dev/problems/scope-not-allowed');
});

test('request timeouts become retryable problem responses', async () => {
  const auth = createAuthFixture();
  const publicActor = await provisionPublicActor(auth);
  const app = createApiApp({
    auth,
    requestTimeoutMs: 5,
    registerPublicRoutes(publicApp) {
      publicApp.get('/slow', async (context) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return context.json({
          ok: true
        });
      });
    }
  });

  const response = await app.request('http://localhost/v1/slow', {
    headers: createJsonBearerHeaders(publicActor.token)
  });
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/upstream-dependency-failed');
  assert.equal(payload.retryable, true);
});

test('readyz reports dependency details and metrics expose request outcomes', async () => {
  const telemetry = new InMemoryApiObservability({ service: 'api-test' });
  const readiness = new RuntimeReadinessMonitor({
    deploymentProfile: 'production-default',
    requiredDependencies: ['auth', 'postgres', 'redis'],
    checks: {
      auth: async () => ({
        boundary: 'auth',
        detail: 'Bearer token validation adapter is healthy.',
        status: 'ok'
      }),
      postgres: async () => ({
        boundary: 'postgres',
        detail: 'Primary registry is reachable.',
        status: 'ok'
      }),
      redis: async () => ({
        boundary: 'redis',
        detail: 'Cache latency is above target but still serving traffic.',
        status: 'degraded'
      })
    }
  });
  const auth = createAuthFixture();
  const publicActor = await provisionPublicActor(auth);
  const app = createApiApp({
    auth,
    readiness,
    serviceName: 'api-test',
    serviceVersion: '2026.01.0',
    telemetry,
    registerPublicRoutes(publicApp) {
      publicApp.get('/probe', (context) =>
        context.json({
          traceId: context.get('trace').traceId
        })
      );
    }
  });

  const readyResponse = await app.request('http://localhost/readyz');
  const readyPayload = await readyResponse.json();
  const probeResponse = await app.request('http://localhost/v1/probe', {
    headers: createJsonBearerHeaders(publicActor.token)
  });
  const metricsResponse = await app.request('http://localhost/metrics');
  const metricsPayload = await metricsResponse.text();

  assert.equal(readyResponse.status, 200);
  assert.equal(readyPayload.status, 'degraded');
  assert.equal(readyPayload.deploymentProfile, 'production-default');
  assert.deepEqual(readyPayload.degradedBoundaries, ['redis']);
  assert.deepEqual(
    readyPayload.dependencies.map((dependency) => dependency.boundary),
    ['auth', 'postgres', 'redis']
  );
  assert.equal(probeResponse.status, 200);
  assert.match(metricsPayload, /cdngine_http_requests_total\{[^}]*path="\/readyz"[^}]*status_code="200"/);
  assert.match(
    metricsPayload,
    /cdngine_readiness_dependency_status\{[^}]*dependency="redis"[^}]*status="degraded"/
  );
  assert.match(metricsPayload, /cdngine_readiness_status\{[^}]*status="degraded"/);
});

test('request telemetry propagates traceparent and redacts bearer values from logs', async () => {
  const telemetry = new InMemoryApiObservability({ service: 'api-test' });
  const auth = createAuthFixture();
  const publicActor = await provisionPublicActor(auth);
  const app = createApiApp({
    auth,
    telemetry,
    registerPublicRoutes(publicApp) {
      publicApp.get('/probe', (context) =>
        context.json({
          traceId: context.get('trace').traceId
        })
      );
    }
  });

  const response = await app.request('http://localhost/v1/probe', {
    headers: createJsonBearerHeaders(publicActor.token, {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    })
  });
  const payload = await response.json();
  const [entry] = telemetry.listRequestLogs();

  assert.equal(response.status, 200);
  assert.equal(payload.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.match(
    response.headers.get('traceparent') ?? '',
    /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/
  );
  assert.equal(entry.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(entry.actorSubject, publicActor.actor.subject);
  assert.equal(entry.authorization, undefined);
  assert.equal(entry.headers, undefined);
});
