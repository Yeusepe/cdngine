# Environment And Deployment

This document defines the intended deployment model for CDNgine.

The platform is designed to be opinionated by default while still allowing adopters to keep their own SQL deployment, object store, CDN, and compute platform when they preserve the platform contracts.

## 1. Environment model

Recommended environments:

| Environment | Purpose |
| --- | --- |
| local | contributor development, contract iteration, workflow debugging |
| integration | storage, workflow, and processor integration validation |
| staging | replay rehearsal, operational checks, and release candidate validation |
| production | customer and internal traffic |

The repository should not treat `local` and `production` as the only meaningful states. Asset platforms fail most often at the integration boundaries between control plane, storage, and worker runtimes.

## 2. Default deployment profile

The opinionated first production profile is:

- stateless API tier
- PostgreSQL control-plane database
- Redis for cache and short-lived coordination
- Temporal for durable orchestration
- Oxen for canonical raw/versioned assets
- S3-compatible derived store for published artifacts
- CDN in front of derived artifacts
- specialized worker pools split by workload profile

## 3. Workload-separated worker pools

Worker pools should be separated because concurrency, memory, and timeout behavior differ materially by workload:

| Pool | Typical work | Operational profile |
| --- | --- | --- |
| image | resize, format conversion, tiles, slices | high concurrency, moderate CPU, lower memory |
| video | transcoding, HLS packaging, poster extraction | lower concurrency, high CPU or GPU, long runtime |
| document | Office-to-PDF normalization, slide rasterization | bursty CPU and memory, failure-prone external tooling |
| archive and package | inventory, scan, unpack, inspect | security-sensitive, bounded scratch storage |

Do not put all workloads into one generic worker deployment if you care about isolation, capacity planning, and predictable failure domains.

## 4. Deployment responsibilities by component

### 4.1 API tier

Owns:

- authentication and authorization
- upload-session creation
- metadata and manifest APIs
- signed delivery URL generation
- operator command surfaces

Expected properties:

- stateless horizontal scaling
- strict request timeouts
- structured logging and trace propagation

### 4.2 Temporal tier

Owns:

- workflow history
- retries and timers
- replay and execution visibility
- activity scheduling

Expected properties:

- durable backing persistence
- explicit workflow versioning discipline
- monitoring of backlog and schedule-to-start latency

### 4.3 Data plane

Owns:

- Oxen for canonical originals
- derived store for published variants
- CDN for hot delivery traffic

Expected properties:

- independent scaling of provenance and delivery storage
- clear private-origin access rules
- retention policies separated by store role

## 5. Regionality and latency posture

The architecture should separate:

- globally reachable API ingress
- regionally appropriate control-plane services
- workload-specific processor placement
- globally cached delivery artifacts

Typical guidance:

- keep the API close to users or edge routing
- keep the control plane in one primary region until operational maturity requires more
- place worker pools where compute and data gravity make sense
- keep delivery artifacts behind a global CDN

## 6. Bring-your-own infrastructure boundaries

Adopters may keep:

- their SQL deployment
- their S3-compatible object store
- their CDN
- their worker compute platform
- their managed or self-hosted Temporal profile

They should not change the platform semantics around:

- canonical raw provenance in Oxen
- deterministic derivative keys
- durable workflow ownership
- registry-driven manifests and recipe bindings

## 7. Rollout and release posture

The platform should support:

- canary or gradual rollout for the API
- worker-pool rollout by capability or queue
- workflow-version migration discipline
- replay rehearsal in staging before production migration

Changes that should not be rolled out casually:

- workflow-definition changes
- deterministic-key schema changes
- manifest-schema changes
- raw-to-derived store contract changes

## 8. Operational dependencies that must be monitored

At minimum:

- PostgreSQL health and connection pressure
- Redis latency and saturation
- Temporal queue backlog and worker availability
- Oxen latency and availability
- derived-store error rate
- CDN error rate and cache-hit ratio

## 9. References

- [Temporal documentation](https://docs.temporal.io/)
- [Redis documentation](https://redis.io/docs/latest/)
- [Cloudflare R2 product page](https://www.cloudflare.com/developer-platform/products/r2/)
