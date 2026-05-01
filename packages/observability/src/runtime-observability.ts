/**
 * Purpose: Records structured request logs, readiness snapshots, and Prometheus-compatible metrics for API-facing production telemetry.
 * Governing docs:
 * - docs/observability.md
 * - docs/security-model.md
 * - docs/traceability.md
 * External references:
 * - https://prometheus.io/docs/instrumenting/exposition_formats/
 * - https://opentelemetry.io/docs/concepts/signals/metrics/
 * Tests:
 * - packages/observability/test/runtime-observability.test.mjs
 */

import type { RuntimeReadinessReport } from './runtime-readiness.js';

export interface RequestTelemetryRecord {
  actorSubject?: string;
  assetId?: string;
  durationMs: number;
  method: string;
  path: string;
  requestId: string;
  requestStartedAt: Date;
  service: string;
  serviceNamespaceId?: string;
  statusCode: number;
  surface: string;
  tenantId?: string;
  traceId: string;
  versionId?: string;
  workflowId?: string;
}

export interface RequestLogEvent extends RequestTelemetryRecord {
  event: 'http_request_completed';
  outcome: 'client-error' | 'server-error' | 'success';
  recordedAt: Date;
}

export interface RequestLogSink {
  write(event: RequestLogEvent): Promise<void> | void;
}

export interface ApiObservability {
  listRequestLogs(): RequestLogEvent[];
  recordReadiness(report: RuntimeReadinessReport): void;
  recordRequest(record: RequestTelemetryRecord): Promise<void>;
  renderPrometheus(): string;
}

export interface InMemoryApiObservabilityOptions {
  service: string;
  sink?: RequestLogSink;
}

interface RequestMetricSample {
  count: number;
  durationTotalMs: number;
  labels: {
    method: string;
    outcome: RequestLogEvent['outcome'];
    path: string;
    service: string;
    statusCode: string;
    surface: string;
  };
}

function escapeLabel(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\n/gu, '\\n').replace(/"/gu, '\\"');
}

function formatLabels(labels: Record<string, string | undefined>): string {
  const entries = Object.entries(labels)
    .filter(([, value]) => typeof value === 'string')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapeLabel(value ?? '')}"`);

  return entries.join(',');
}

function cloneRequestLog(event: RequestLogEvent): RequestLogEvent {
  return {
    ...event,
    recordedAt: new Date(event.recordedAt),
    requestStartedAt: new Date(event.requestStartedAt)
  };
}

function toOutcome(statusCode: number): RequestLogEvent['outcome'] {
  if (statusCode >= 500) {
    return 'server-error';
  }

  if (statusCode >= 400) {
    return 'client-error';
  }

  return 'success';
}

export class InMemoryRequestLogSink implements RequestLogSink {
  private readonly events: RequestLogEvent[] = [];

  listEvents(): RequestLogEvent[] {
    return this.events.map((event) => cloneRequestLog(event));
  }

  write(event: RequestLogEvent): void {
    this.events.push(cloneRequestLog(event));
  }
}

export class ConsoleJsonRequestLogSink implements RequestLogSink {
  private readonly writer: (line: string) => void;

  constructor(writer: (line: string) => void = (line) => console.log(line)) {
    this.writer = writer;
  }

  write(event: RequestLogEvent): void {
    this.writer(JSON.stringify(event));
  }
}

export class InMemoryApiObservability implements ApiObservability {
  private readonly logs = new InMemoryRequestLogSink();
  private readonly metricSamples = new Map<string, RequestMetricSample>();
  private readinessReport?: RuntimeReadinessReport;
  private readonly service: string;
  private readonly sink: RequestLogSink | undefined;

  constructor(options: InMemoryApiObservabilityOptions) {
    this.service = options.service;
    this.sink = options.sink;
  }

  listRequestLogs(): RequestLogEvent[] {
    return this.logs.listEvents();
  }

  recordReadiness(report: RuntimeReadinessReport): void {
    this.readinessReport = {
      ...report,
      checkedAt: new Date(report.checkedAt),
      dependencies: report.dependencies.map((dependency) => ({
        ...dependency,
        checkedAt: new Date(dependency.checkedAt)
      }))
    };
  }

  async recordRequest(record: RequestTelemetryRecord): Promise<void> {
    const outcome = toOutcome(record.statusCode);
    const event: RequestLogEvent = {
      ...record,
      event: 'http_request_completed',
      outcome,
      recordedAt: new Date()
    };
    const key = JSON.stringify({
      method: record.method,
      outcome,
      path: record.path,
      service: record.service,
      statusCode: record.statusCode,
      surface: record.surface
    });
    const sample = this.metricSamples.get(key);

    if (sample) {
      sample.count += 1;
      sample.durationTotalMs += record.durationMs;
    } else {
      this.metricSamples.set(key, {
        count: 1,
        durationTotalMs: record.durationMs,
        labels: {
          method: record.method,
          outcome,
          path: record.path,
          service: record.service,
          statusCode: String(record.statusCode),
          surface: record.surface
        }
      });
    }

    this.logs.write(event);
    await this.sink?.write(event);
  }

  renderPrometheus(): string {
    const lines = [
      '# HELP cdngine_http_requests_total Count of completed HTTP requests by path, surface, and status.',
      '# TYPE cdngine_http_requests_total counter',
      '# HELP cdngine_http_request_duration_ms_total Total observed HTTP request duration in milliseconds.',
      '# TYPE cdngine_http_request_duration_ms_total counter',
      '# HELP cdngine_http_request_duration_ms_count Number of HTTP request duration samples.',
      '# TYPE cdngine_http_request_duration_ms_count counter'
    ];

    for (const sample of this.metricSamples.values()) {
      const labels = formatLabels({
        method: sample.labels.method,
        outcome: sample.labels.outcome,
        path: sample.labels.path,
        service: sample.labels.service,
        status_code: sample.labels.statusCode,
        surface: sample.labels.surface
      });

      lines.push(`cdngine_http_requests_total{${labels}} ${sample.count}`);
      lines.push(`cdngine_http_request_duration_ms_total{${labels}} ${sample.durationTotalMs}`);
      lines.push(`cdngine_http_request_duration_ms_count{${labels}} ${sample.count}`);
    }

    lines.push('# HELP cdngine_readiness_status Current readiness summary for the service.');
    lines.push('# TYPE cdngine_readiness_status gauge');
    lines.push('# HELP cdngine_readiness_dependency_status Current readiness result for each required dependency.');
    lines.push('# TYPE cdngine_readiness_dependency_status gauge');

    if (this.readinessReport) {
      lines.push(
        `cdngine_readiness_status{${formatLabels({
          deployment_profile: this.readinessReport.deploymentProfile,
          service: this.service,
          status: this.readinessReport.status
        })}} 1`
      );

      for (const dependency of this.readinessReport.dependencies) {
        lines.push(
          `cdngine_readiness_dependency_status{${formatLabels({
            dependency: dependency.boundary,
            deployment_profile: this.readinessReport.deploymentProfile,
            service: this.service,
            status: dependency.status
          })}} 1`
        );
      }
    }

    return `${lines.join('\n')}\n`;
  }
}

