# Resilience And Scale Validation

This document defines the evidence required before claiming the platform is durable, replayable, and ready for real traffic.

Architecture prose is not enough. Asset platforms fail under retries, malformed files, partial publication, and operator stress. This document exists to force those realities into the implementation plan.

## 1. Validation objectives

The platform should demonstrate:

1. idempotent upload completion
2. deterministic replay from canonical source identities
3. safe retry behavior for registry and storage mutations
4. clear dead-letter handling
5. predictable degradation under load
6. operator-visible recovery paths

## 2. Failure classes to validate

### 2.1 API and ingest failures

- duplicate upload completion
- raw store temporarily unavailable
- invalid file signatures
- oversized payloads
- auth failure on completion callbacks

### 2.2 Workflow failures

- workflow worker restart
- activity timeout
- non-retryable validation rejection
- partial recipe fan-out failure
- workflow version migration

### 2.3 Processor failures

- malformed inputs
- dependency crash
- long-running transcoder timeout
- partial output publication
- exhausted scratch disk or memory

### 2.4 Delivery failures

- manifest references missing derivative objects
- CDN origin miss storms
- signed URL failures
- stale cache after replay or republish

## 3. Evidence categories

Every major slice should aim to produce evidence in these forms:

| Evidence type | Meaning |
| --- | --- |
| specification tests | behavior is defined and regression-resistant |
| workflow tests | retries, timers, replay, and compensation are executable |
| integration tests | storage and registry semantics are real, not mocked guesses |
| load and soak evidence | throughput and failure recovery are observed under pressure |
| runbook alignment | operators can actually perform recovery actions |
| telemetry alignment | failures produce understandable traces, metrics, and audit records |

## 4. Minimum validation matrix

### 4.1 Upload and provenance

Must prove:

- duplicate completion requests do not duplicate state
- canonical raw assets are replayable from the source repository
- repeated revisions of binary-heavy assets benefit from source deduplication without breaking replay
- invalid content is rejected without publishing derivatives

### 4.2 Derivative publication

Must prove:

- deterministic keys are stable across retries
- manifest publication does not point at missing artifacts
- partial failures are visible and recoverable

### 4.3 Replay

Must prove:

- replay starts from the canonical source identity
- registry state is updated coherently after replay
- rewritten deterministic outputs remain addressable

### 4.4 Delivery

Must prove:

- published artifacts are CDN-cacheable
- private delivery remains signed and bounded
- the hot derivative read path does not depend on the source repository

## 5. Scale scenarios

The platform should be exercised against at least these scenario families:

### 5.1 Image-heavy burst

- many concurrent uploads
- many small derivative fan-outs
- hot cache pressure on popular variants

### 5.2 Video-heavy saturation

- fewer but much longer jobs
- CPU or GPU bottlenecks
- queue backlog and retry pressure

### 5.3 Presentation-heavy conversion bursts

- office and PDF conversions in batches
- failure clusters from external conversion tooling
- slide-raster publication integrity

### 5.4 Archive and package inspection

- suspicious or malformed archives
- malware-scan latency
- bounded scratch-space behavior

## 6. Operator readiness validation

Operators should be able to:

1. identify where an asset failed
2. distinguish validation rejection from infrastructure failure
3. drain dead letters safely
4. replay a version deterministically
5. quarantine risky assets
6. confirm publication success

If those actions exist only in theory, the platform is not operationally ready.

## 7. Exit criteria for a production slice

A slice is closer to production-ready when it shows:

- docs aligned with implementation
- repeatable workflow tests
- real integration tests against storage and registry systems
- basic load evidence
- operator runbook coverage
- observability and alerting coverage for the validated failure modes

## 8. References

- [Temporal documentation](https://docs.temporal.io/)
- [FFmpeg documentation](https://ffmpeg.org/documentation.html)
- [Redis documentation](https://redis.io/docs/latest/)
