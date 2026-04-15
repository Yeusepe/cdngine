/**
 * Purpose: Defines readiness aggregation for core platform boundaries so health checks can surface not-ready versus degraded states without ad hoc string handling.
 * Governing docs:
 * - docs/observability.md
 * - docs/slo-and-capacity.md
 * External references:
 * - https://opentelemetry.io/docs/
 * Tests:
 * - packages/observability/test/observability.test.mjs
 */

export interface ReadinessSignal {
  boundary: string;
  detail?: string;
  status: 'ok' | 'degraded' | 'failed';
}

export interface ReadinessSummary {
  degradedBoundaries: string[];
  failedBoundaries: string[];
  status: 'degraded' | 'not-ready' | 'ready';
}

export function summarizeReadiness(signals: ReadinessSignal[]): ReadinessSummary {
  const degradedBoundaries = signals
    .filter((signal) => signal.status === 'degraded')
    .map((signal) => signal.boundary);
  const failedBoundaries = signals
    .filter((signal) => signal.status === 'failed')
    .map((signal) => signal.boundary);

  return {
    degradedBoundaries,
    failedBoundaries,
    status: failedBoundaries.length > 0 ? 'not-ready' : degradedBoundaries.length > 0 ? 'degraded' : 'ready'
  };
}
