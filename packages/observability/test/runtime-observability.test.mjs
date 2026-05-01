/**
 * Purpose: Verifies runtime trace propagation, structured request logging, readiness monitoring, and Prometheus metric rendering for production observability wiring.
 * Governing docs:
 * - docs/observability.md
 * - docs/environment-and-deployment.md
 * - docs/security-model.md
 * External references:
 * - https://www.w3.org/TR/trace-context/
 * - https://prometheus.io/docs/instrumenting/exposition_formats/
 * Tests:
 * - packages/observability/test/runtime-observability.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryApiObservability,
  RuntimeReadinessMonitor,
  resolveTraceContext
} from '../dist/index.js';

test('resolveTraceContext preserves upstream trace IDs and rotates the local span ID', () => {
  const trace = resolveTraceContext(
    new Headers({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    })
  );

  assert.equal(trace.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(trace.parentSpanId, '00f067aa0ba902b7');
  assert.match(trace.spanId, /^[0-9a-f]{16}$/);
  assert.notEqual(trace.spanId, '00f067aa0ba902b7');
  assert.match(trace.traceparent, /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
});

test('runtime readiness monitor fails missing checks and observability renders metrics plus logs', async () => {
  const telemetry = new InMemoryApiObservability({ service: 'api-test' });
  const readiness = new RuntimeReadinessMonitor({
    deploymentProfile: 'production-default',
    requiredDependencies: ['auth', 'postgres'],
    checks: {
      postgres: async () => ({
        boundary: 'postgres',
        detail: 'Registry is healthy.',
        status: 'ok'
      })
    }
  });
  const report = await readiness.check();

  telemetry.recordReadiness(report);
  await telemetry.recordRequest({
    actorSubject: 'user_123',
    durationMs: 12,
    method: 'GET',
    path: '/v1/assets',
    requestId: 'req_123',
    requestStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    service: 'api-test',
    statusCode: 200,
    surface: 'public',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
  });

  const [entry] = telemetry.listRequestLogs();
  const metrics = telemetry.renderPrometheus();

  assert.equal(report.status, 'not-ready');
  assert.equal(report.failedBoundaries[0], 'auth');
  assert.match(report.dependencies[0].detail ?? '', /No readiness check configured/);
  assert.equal(entry.authorization, undefined);
  assert.equal(entry.headers, undefined);
  assert.match(metrics, /cdngine_http_requests_total\{[^}]*path="\/v1\/assets"[^}]*status_code="200"/);
  assert.match(metrics, /cdngine_readiness_status\{[^}]*status="not-ready"/);
});

