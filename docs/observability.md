# Observability

This document defines the observability contract for CDNgine.

The platform is not considered production-ready if operators cannot answer these questions quickly:

1. what happened to this asset version?
2. where is the workflow stalled or retrying?
3. which processor, recipe, or dependency is failing?
4. whether delivery is healthy at the CDN and origin layers
5. whether replay, quarantine, or operator actions changed state correctly

## 1. Observability goals

The platform should make it cheap to:

- trace a single asset version from upload session to published derivative
- understand queueing, workflow, and processor saturation separately
- distinguish validation failure from transient infrastructure failure
- correlate API events, workflow events, and storage mutations
- inspect tenant- or namespace-specific behavior without losing global service health

## 2. Default telemetry stack

The default telemetry posture is:

| Concern | Default |
| --- | --- |
| traces | OpenTelemetry |
| logs | structured application logs with service, asset, and workflow correlation |
| metrics | OpenTelemetry metrics exported to the chosen backend |
| ingest metrics | tusd Prometheus metrics plus API-side ingest metrics |
| workflow visibility | Temporal execution history and workflow metrics |
| audit events | relational registry plus operator-visible event records |

The platform should not invent its own tracing format or correlation scheme.

Collector-side sampling policy should prefer keeping failures, high-latency traces, and operator actions rather than sampling all traffic uniformly.

## 3. Core signal families

### 3.1 API and ingest

Track:

- request rate
- request latency by endpoint and namespace
- authentication and authorization failures
- upload-session creation latency
- upload completion latency
- idempotency hit rate
- invalid input and validation rejection rate

### 3.2 Workflow and orchestration

Track:

- workflow start rate
- workflow schedule-to-start latency
- workflow execution duration
- retry count by activity and recipe
- dead-letter volume
- replay volume
- terminal failure count by workflow type
- waiting-run count by workflow type
- cancellation count by workflow type and reason category

### 3.3 Processor runtime

Track:

- job throughput by worker pool
- CPU, memory, disk, and GPU saturation
- processor queue lag
- failure rate by capability, recipe, and file class
- timeout rate
- malformed-input rate

### 3.4 Storage and delivery

Track:

- canonical source read and write latency
- canonical source deduplication ratio and bytes avoided
- canonical source reconstruction latency and cache-hit rate
- lazy-read miss amplification and hot-cache hit rate where those layers are enabled
- artifact-graph publish latency and failure rate
- derived-store write latency and failure rate
- CDN cache-hit ratio by derivative class
- CDN tiered-cache or shield hit behavior where the provider exposes it
- origin miss rate
- manifest fetch latency
- segment fetch latency
- signed URL validation failure rate
- signed-cookie validation failure rate
- unauthorized public-read rate

## 4. Correlation model

Every signal should carry the strongest safe set of correlation dimensions available:

- `service`
- `namespace`
- `tenant_id` where applicable
- `asset_id`
- `version_id`
- `workflow_id`
- `workflow_run_id`
- `job_id`
- `recipe_id`
- `capability_id`
- `delivery_scope_id`
- `delivery_key`
- `outcome`

These fields are more important than verbose free-text logs. Operators need machine-filterable dimensions first.

Route-level request IDs must be propagated from the API surface into workflow start, storage operations, and audit events so a single upload or replay request can be reconstructed later.

## 5. Trace boundaries

The expected top-level trace path is:

`API request` -> `registry mutation` -> `workflow start` -> `activity execution` -> `processor/storage operations` -> `registry publication`

Delivery requests should form a different trace family:

`metadata lookup or signed URL generation` -> `CDN request` -> `derived origin fetch on miss`

The delivery path must not appear to depend on the canonical source repository during ordinary derivative fetches.

## 6. Asset lineage observability

Every asset version should be observable as a lineage, not just as unrelated log lines.

Minimum lineage checkpoints:

1. upload session created
2. raw asset canonicalized into the source repository
3. upload marked complete
4. workflow started
5. validation passed, failed, or quarantined
6. recipe jobs scheduled
7. derivative objects written
8. manifest published
9. delivery ready
10. replay or operator intervention, if any

## 7. Critical dashboards

Operators should have at least these dashboards:

### 7.1 Ingest health

- request rate and latency
- upload completion success
- validation rejection rate
- source snapshot latency
- source deduplication effectiveness

### 7.2 Workflow health

- queue backlog
- schedule-to-start latency
- retries by workflow and activity
- dead-letter and replay counts

### 7.3 Worker-pool health

- throughput by pool
- saturation by resource
- timeout and crash rate
- failure clusters by file class and recipe

### 7.4 Delivery health

- CDN hit ratio
- CDN tiered-cache effectiveness where available
- origin latency
- derived-store error rate
- signed URL failures
- signed-cookie failures
- manifest-versus-segment error split

### 7.5 Operator actions

- replay frequency
- quarantine volume
- purge activity
- manual overrides and administrative mutations

## 8. Alerting posture

Alert on conditions that require action, not on every noisy blip.

High-priority alerts include:

- workflow backlog above agreed operational threshold
- repeated processor failures for a capability or recipe
- dead-letter queue growth without drain
- canonical source repository unavailable for snapshotting or source reconstruction
- derived-store write failures blocking publication
- CDN or origin errors causing delivery failure for published derivatives
- operator replay failures

## 9. Audit and security events

Separate audit signals from routine application logs.

Audit events should include:

- upload session creation
- upload completion
- asset visibility changes
- recipe-binding changes
- replay requests
- quarantine and release actions
- delete or retention-policy actions
- privileged operator access

## 10. Evidence expected from implementation

A finished slice should show:

- route-level telemetry in the API service
- workflow and activity traces
- processor metrics with resource saturation
- asset-lineage correlation fields
- dashboard definitions or equivalent operational views
- alert definitions for core failure modes

## 11. References

- [OpenTelemetry docs](https://opentelemetry.io/docs/)
- [OpenTelemetry sampling](https://opentelemetry.io/docs/concepts/sampling/)
- [Temporal documentation](https://docs.temporal.io/)
- [tusd monitoring](https://tus.github.io/tusd/advanced-topics/monitoring/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [SeaweedFS tiered storage](https://github.com/seaweedfs/seaweedfs/wiki/Tiered-Storage)
- [Cloudflare Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
