# Storage Tiering And Materialization

This document defines how CDNgine should place bytes across hot, warm, and cold storage while keeping source history small and delivery fast.

## 1. Why this document exists

The platform has two conflicting goals:

1. retain huge iterative source assets cheaply
2. serve hot outputs and repeated internal reads quickly

Those goals should not be solved by one undifferentiated bucket.

## 2. Byte-placement model

| Layer | Primary concern | Default reference |
| --- | --- | --- |
| canonical source repository | deduplicated snapshot history for immutable source versions | Kopia |
| tiered operational substrate | local and cloud placement, disk classes, S3 access, replication | SeaweedFS by default, JuiceFS when POSIX semantics matter |
| worker hot cache | repeated chunk or file reads close to compute | worker-local cache, optional Alluxio |
| lazy-read representation | on-demand reads for package-like or rebuildable assets | Nydus |
| artifact graph | immutable bundle and manifest references | ORAS / OCI artifacts |
| browser delivery store | CDN-friendly whole objects and manifests | S3-compatible derived store |

## 3. Hot, warm, and cold rules

### 3.1 Hot

Hot bytes are those needed repeatedly in a short window:

- active worker input chunks
- frequently read package-like assets
- current published derivatives
- artifact indexes and manifests

### 3.2 Warm

Warm bytes are still likely to be reused soon, but do not justify the most expensive placement:

- recent source versions from active projects
- recent derived outputs outside the hottest window
- reusable intermediate bundles

### 3.3 Cold

Cold bytes are reconstructable history:

- older source revisions
- rarely requested exports
- purge-protected provenance evidence

Cold does not mean inaccessible. It means reconstructable without paying hot-storage costs everywhere.

## 4. Materialization rules

Preferred policy:

1. do not permanently store every possible derivative
2. materialize hot browser-facing outputs when demand or policy justifies it
3. keep chunked or snapshot forms as the durable truth for large iterative sources
4. let workers or trusted tools use lazy chunk-aware reads where it improves throughput
5. evict materialized outputs when they are cheaper to rebuild than to store forever

## 5. Default product posture

The default product posture is:

- **source assets**: always snapshot into **Kopia**
- **published web outputs**: materialize into the derived store and serve via CDN
- **package-like internal hot reads**: prefer **Nydus** when compatible with the consumer
- **artifact bundles and manifests**: publish through ORAS where an immutable bundle graph is helpful

CDNgine should integrate these systems, not clone their behavior in application code.

## 6. Promotion and demotion signals

The orchestrator should use explicit signals such as:

- recent access frequency
- queue backlog pressure
- rebuild cost
- source-size and chunk reuse
- tenant or namespace retention policy
- current storage pressure
- publication or SLA requirements

## 7. Read more

- [Architecture](./architecture.md)
- [Canonical Source And Tiering Contract](./canonical-source-and-tiering-contract.md)
- [Original Source Delivery](./original-source-delivery.md)
- [Environment And Deployment](./environment-and-deployment.md)
- [SeaweedFS tiered storage](https://github.com/seaweedfs/seaweedfs/wiki/Tiered-Storage)
- [Alluxio overview](https://documentation.alluxio.io/os-en)
- [Nydus](https://nydus.dev/)
