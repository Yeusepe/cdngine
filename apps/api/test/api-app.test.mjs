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

import { createApiApp, requireRequestedScope } from '../dist/api-app.js';
import { getRequestLogContext } from '../dist/request-context.js';
import { validateJsonBody } from '../dist/validation.js';

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
  const app = createApiApp({
    registerOperatorRoutes(operatorApp) {
      operatorApp.get('/diagnostics', (context) =>
        context.json({
          requestId: context.get('requestId')
        })
      );
    }
  });

  const response = await app.request('http://localhost/v1/operator/diagnostics', {
    headers: {
      authorization: 'Bearer user_123',
      'x-cdngine-roles': 'public-user'
    }
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/forbidden');
});

test('validation middleware and scope enforcement share the same problem posture', async () => {
  const app = createApiApp({
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
    headers: {
      authorization: 'Bearer user_123',
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const invalidPayload = await invalidResponse.json();

  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.type, 'https://docs.cdngine.dev/problems/invalid-request');

  const forbiddenResponse = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer user_123',
      'content-type': 'application/json',
      'x-cdngine-allowed-namespaces': 'creative-services'
    },
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform'
    })
  });
  const forbiddenPayload = await forbiddenResponse.json();

  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbiddenPayload.type, 'https://docs.cdngine.dev/problems/scope-not-allowed');
});

test('request timeouts become retryable problem responses', async () => {
  const app = createApiApp({
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
    headers: {
      authorization: 'Bearer user_123'
    }
  });
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/upstream-dependency-failed');
  assert.equal(payload.retryable, true);
});
