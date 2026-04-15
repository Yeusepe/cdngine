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

## 1.1 Local fast-start profile

The simplest supported local setup should optimize for **time-to-first-run**, not full production parity.

The current local fast-start posture is:

- PostgreSQL
- Redis
- Temporal plus Temporal UI
- RustFS as the local S3-compatible backend
- tusd backed by that RustFS instance
- Kopia repository server backed by a RustFS bucket and source prefix
- a separate RustFS exports bucket for source-download export paths
- local OCI registry for ORAS-compatible publication tests

RustFS is acceptable here because the local goal is contributor speed and predictable one-command bring-up. The broader reference architecture still prefers **SeaweedFS** as the default substrate when moving beyond the fast-start profile.

RustFS's S3-compatible API and read-after-write consistency make it a good fast-start backing store for the local dependency stack. In fuller environments, move to SeaweedFS when explicit tiering, filer semantics, and hot/warm/cold placement become part of the requirement.

The default local packaging is therefore **single-node + multi-bucket**, with a documented path to **single-node + single-bucket** by reusing one bucket name and switching to distinct prefixes.

See [`deploy/local-platform/README.md`](../deploy/local-platform/README.md) for the actual compose-based bring-up.

## 2. Default deployment profile

The opinionated first production profile is:

- stateless API tier
- dedicated tusd ingest tier backed by object storage
- PostgreSQL control-plane database
- Redis for cache and short-lived coordination
- Temporal for durable orchestration
- Kopia canonical source repository over SeaweedFS-backed storage
- optional JuiceFS workspaces where POSIX access is required
- optional Nydus or Alluxio hot-read layer close to workers
- ORAS-backed artifact graph
- S3-compatible derived store for published artifacts
- CDN in front of derived artifacts
- specialized worker pools split by workload profile

This production-oriented profile is intentionally richer than the local fast-start profile. Local development should not require full production topology just to make progress.

The important storage rule is: source assets may live physically in the tiered substrate, but application code should address them through canonical repository identities rather than raw canonical object keys.

The deployment model does not change the core lifecycle:

`stage -> canonicalize -> process -> publish -> deliver`

Single-node versus multi-node and one-bucket versus multi-bucket are packaging choices around that lifecycle.

## 2.1 Storage bucket topology

CDNgine should support both **multi-bucket** and **one-bucket** deployments.

### One-bucket deployment

One S3-compatible namespace is enough when the adopter only has one bucket:

- `ingest/` for tusd staging
- `source/` for the Kopia-backed canonical repository
- `derived/` for published CDN-facing derivatives
- `exports/` for repeated original-source downloads when export mode is enabled

This model works well for local RustFS setups and smaller installations. The important rule is that the control plane persists logical source and delivery identities, not raw object keys.

### Multi-bucket deployment

Larger or stricter deployments may split those roles into separate buckets:

- `cdngine-ingest`
- `cdngine-source`
- `cdngine-derived`
- `cdngine-exports` when repeated source-export traffic matters

Separate buckets improve policy isolation, lifecycle tuning, and operational visibility, but they are not required for the platform semantics.

### 2.1.1 Checked-in runtime config surface

The repository now carries explicit deployment-profile inputs in `deploy/production/` and matching typed loaders in the codebase:

- `packages/storage/src/runtime-storage-config.ts`
- `packages/observability/src/readiness-profile.ts`
- `deploy/production/runtime.one-bucket.env.example`
- `deploy/production/runtime.multi-bucket.env.example`

Those files are the checked-in answer to "how does one-bucket versus multi-bucket packaging preserve the same storage-role semantics?" The storage loader resolves environment variables into the existing normalized `ingest`, `source`, `derived`, and `exports` roles, while the readiness loader resolves which dependencies must be healthy for each deployment profile.

The intended environment variables are:

- `CDNGINE_STORAGE_LAYOUT_MODE`
- `CDNGINE_STORAGE_BUCKET` or the split-bucket variables `CDNGINE_INGEST_BUCKET`, `CDNGINE_SOURCE_BUCKET`, `CDNGINE_DERIVED_BUCKET`, `CDNGINE_EXPORTS_BUCKET`
- `CDNGINE_INGEST_PREFIX`, `CDNGINE_SOURCE_PREFIX`, `CDNGINE_DERIVED_PREFIX`, `CDNGINE_EXPORTS_PREFIX`
- `CDNGINE_TIERING_SUBSTRATE`
- `CDNGINE_SOURCE_DELIVERY_MODE`
- `CDNGINE_HOT_READ_LAYER`
- `CDNGINE_DEPLOYMENT_PROFILE`
- `CDNGINE_READINESS_REQUIRED`

### 2.1.2 Who moves bytes between hot, warm, and cold

This is one of the easiest places to get confused, so the ownership should be explicit:

- **CDN**: caches and evicts edge copies of published derivatives or exports
- **RustFS**: can apply bucket lifecycle and policy-based object tiering in simple S3-compatible deployments
- **SeaweedFS**: owns fuller tiered-storage placement and administrative movement in richer deployments
- **Alluxio / Nydus / worker-local cache**: accelerate repeated worker reads near compute
- **CDNgine**: decides when to publish, export, replay, or prewarm; it does not normally implement a custom byte-tiering loop itself

There is no standard "CDN to cold" pipeline. The CDN is an edge cache in front of the origin. Hot/warm/cold movement happens in the backing storage substrate and cache layers behind that origin.

The practical consequence is:

1. a derivative is published to the derived store or an original is materialized to exports
2. the CDN fills its edge cache on demand
3. the origin store may later transition older objects to colder media according to RustFS or SeaweedFS policy
4. a later miss can still be served from origin, even if the object is no longer on the hottest media

## 2.2 Node topology

CDNgine should support both **single-node** and **multi-node** deployments.

### Single-node deployment

Single-node means the platform is co-located on one machine or one small compose-style host. The services are still logically separate, but they are packaged together for low operational overhead.

Typical posture:

- API, tusd, workers, PostgreSQL, Redis, and Temporal on one host
- RustFS or another S3-compatible store on the same host or very close to it
- one bucket with prefixes or multiple buckets, depending on operator preference

This is valid for local development, trials, and smaller installations.

### Multi-node deployment

Multi-node means packaging by role:

- API replicas on edge or app nodes
- tusd on ingest nodes
- PostgreSQL, Redis, and Temporal on control-plane nodes
- workload-specific workers on dedicated compute nodes
- object storage and OCI registry on separate storage services

This is the normal direction when throughput, isolation, or failure-domain control matters.

## 2.3 Combined topology matrix

| Node topology | Storage topology | Supported | Typical use |
| --- | --- | --- | --- |
| single-node | single-bucket | yes | smallest install with one object namespace and prefixes |
| single-node | multi-bucket | yes | current local fast-start default and a clean small-install posture |
| multi-node | single-bucket | yes | split compute and control plane before splitting storage |
| multi-node | multi-bucket | yes | fuller production posture with cleaner lifecycle and policy boundaries |

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
- upload completion acceptance and canonicalization command handling
- metadata and manifest APIs
- signed delivery URL generation
- operator command surfaces

Expected properties:

- stateless horizontal scaling
- strict request timeouts
- structured logging and trace propagation

### 4.1.1 Ingest tier

Owns:

- resumable upload protocol handling
- staged-object persistence before canonicalization
- hook-driven metadata validation
- ingest metrics and operational visibility

Expected properties:

- object-storage-backed persistence in production
- no dependence on local shared-disk locking for clustered deployments
- Cloudflare R2-specific multipart tuning when R2 is used

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

- canonical source repository for originals
- tiered storage substrate for byte placement
- optional lazy-read or hot-cache layer for package-like internal reads
- ORAS artifact graph for immutable bundle references
- derived store for published variants
- CDN for hot delivery traffic

Expected properties:

- independent scaling of canonical, hot-cache, and derived storage
- clear private-origin access rules
- retention policies separated by store role
- worker-local or distributed caches only where repeated reconstructions justify them
- canonical repository storage backed by an explicit bucket or prefix, even when the public identity is the Kopia snapshot or manifest identifier

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

- canonical raw provenance and deduplicated source history
- deterministic derivative keys
- durable workflow ownership
- registry-driven manifests and recipe bindings

## 7. Rollout and release posture

The platform should support:

- canary or gradual rollout for the API
- worker-pool rollout by capability or queue
- workflow-version migration discipline
- replay rehearsal in staging before production migration

Workflow-code deployments should use Temporal safe-deployment practices, with replay verification before traffic is shifted.

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
- source snapshot latency, reconstruction health, and availability
- hot-cache effectiveness and lazy-read miss amplification where those layers are enabled
- derived-store error rate
- CDN error rate and cache-hit ratio

## 9. References

- [Temporal documentation](https://docs.temporal.io/)
- [Redis documentation](https://redis.io/docs/latest/)
- [Cloudflare R2 product page](https://www.cloudflare.com/developer-platform/products/r2/)
- [Kopia features](https://kopia.io/docs/features/)
- [RustFS S3 compatibility](https://docs.rustfs.com/features/s3-compatibility/)
- [RustFS architecture](https://docs.rustfs.com/concepts/architecture.html)
- [SeaweedFS tiered storage](https://github.com/seaweedfs/seaweedfs/wiki/Tiered-Storage)
- [JuiceFS architecture](https://juicefs.com/docs/community/architecture)
- [Nydus](https://nydus.dev/)
