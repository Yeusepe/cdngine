/**
 * Purpose: Implements W3C trace-context parsing and propagation so API, worker, and operator paths can share one request-correlation contract.
 * Governing docs:
 * - docs/observability.md
 * - docs/service-architecture.md
 * - docs/traceability.md
 * External references:
 * - https://www.w3.org/TR/trace-context/
 * - https://opentelemetry.io/docs/concepts/signals/traces/
 * Tests:
 * - packages/observability/test/runtime-observability.test.mjs
 */

import { randomBytes } from 'node:crypto';

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;

export interface TraceContext {
  parentSpanId?: string;
  source: 'generated' | 'upstream';
  spanId: string;
  traceFlags: string;
  traceId: string;
  traceparent: string;
}

function createHex(length: number): string {
  return randomBytes(length / 2).toString('hex');
}

function isAllZeros(value: string): boolean {
  return /^0+$/u.test(value);
}

function readTraceparent(headers: Headers | Record<string, string>): string | undefined {
  const source = headers instanceof Headers ? headers : new Headers(headers);
  const candidate = source.get('traceparent')?.trim().toLowerCase();
  return candidate ? candidate : undefined;
}

export function resolveTraceContext(headers: Headers | Record<string, string>): TraceContext {
  const traceparent = readTraceparent(headers);
  const parsed = traceparent ? traceparent.match(traceparentPattern) : null;

  const traceId = parsed?.[1];
  const parentSpanId = parsed?.[2];
  const traceFlags = parsed?.[3];

  if (traceId && parentSpanId && traceFlags && !isAllZeros(traceId) && !isAllZeros(parentSpanId)) {
    const spanId = createHex(16);

    return {
      parentSpanId,
      source: 'upstream',
      spanId,
      traceFlags,
      traceId,
      traceparent: `00-${traceId}-${spanId}-${traceFlags}`
    };
  }

  const generatedTraceId = createHex(32);
  const spanId = createHex(16);
  const generatedTraceFlags = '01';

  return {
    source: 'generated',
    spanId,
    traceFlags: generatedTraceFlags,
    traceId: generatedTraceId,
    traceparent: `00-${generatedTraceId}-${spanId}-${generatedTraceFlags}`
  };
}

