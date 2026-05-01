/**
 * Purpose: Proves the production-hardening surface across authenticated request handling, readiness reporting, trace propagation, and Prometheus metrics exposure.
 * Governing docs:
 * - docs/testing-strategy.md
 * - docs/environment-and-deployment.md
 * - docs/observability.md
 * - docs/security-model.md
 * External references:
 * - https://www.w3.org/TR/trace-context/
 * - https://prometheus.io/docs/instrumenting/exposition_formats/
 * Tests:
 * - tests/conformance/production-hardening.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryApiObservability,
  RuntimeReadinessMonitor
} from '../../packages/observability/dist/index.js';
import { createApiApp } from '../../apps/api/dist/api-app.js';
import {
  createAuthFixture,
  createJsonBearerHeaders,
  provisionPublicActor
} from '../auth-fixture.mjs';

test('production app exposes trace-aware readiness and metrics around authenticated traffic', async () => {
  const telemetry = new InMemoryApiObservability({ service: 'api-conformance' });
  const readiness = new RuntimeReadinessMonitor({
    deploymentProfile: 'production-default',
    requiredDependencies: ['auth', 'postgres', 'redis', 'temporal'],
    checks: {
      auth: async () => ({ boundary: 'auth', detail: 'Auth is healthy.', status: 'ok' }),
      postgres: async () => ({ boundary: 'postgres', detail: 'Registry is healthy.', status: 'ok' }),
      redis: async () => ({ boundary: 'redis', detail: 'Redis is healthy.', status: 'ok' }),
      temporal: async () => ({
        boundary: 'temporal',
        detail: 'Temporal backlog is elevated but progressing.',
        status: 'degraded'
      })
    }
  });
  const auth = createAuthFixture();
  const actor = await provisionPublicActor(auth);
  const app = createApiApp({
    auth,
    readiness,
    telemetry,
    registerPublicRoutes(publicApp) {
      publicApp.get('/assets', (context) =>
        context.json({
          requestId: context.get('requestId'),
          traceId: context.get('trace').traceId
        })
      );
    }
  });

  const assetResponse = await app.request('http://localhost/v1/assets', {
    headers: createJsonBearerHeaders(actor.token, {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    })
  });
  const assetPayload = await assetResponse.json();
  const readyResponse = await app.request('http://localhost/readyz');
  const readyPayload = await readyResponse.json();
  const metricsResponse = await app.request('http://localhost/metrics');
  const metrics = await metricsResponse.text();

  assert.equal(assetResponse.status, 200);
  assert.equal(assetPayload.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(readyResponse.status, 200);
  assert.equal(readyPayload.status, 'degraded');
  assert.deepEqual(readyPayload.degradedBoundaries, ['temporal']);
  assert.match(metrics, /cdngine_http_requests_total\{[^}]*path="\/v1\/assets"[^}]*surface="public"/);
  assert.match(metrics, /cdngine_readiness_dependency_status\{[^}]*dependency="temporal"[^}]*status="degraded"/);
});

