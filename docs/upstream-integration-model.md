# Upstream Integration Model

This document defines exactly how CDNgine connects the chosen upstream systems.

The goal is to stop the architecture from sounding like "inspired by" and make it explicit that CDNgine should **consume these systems directly** through their supported APIs, SDKs, daemons, and CLIs instead of rebuilding their core behavior.

## 1. Integration rules

1. **Public SDKs talk to CDNgine, not to the upstream stack directly.**
2. **CDNgine adapters consume upstream systems through stable boundaries** such as HTTP, S3, OCI, official SDKs, or controlled CLI invocations.
3. **If there is no good TypeScript SDK, use a managed sidecar or CLI boundary** instead of reimplementing the upstream protocol in app code.
4. **Custom code should stay in policy, orchestration, manifest semantics, registration, and adapter glue**. It should not reimplement snapshot repositories, object stores, lazy filesystems, or OCI graph semantics.

## 2. Public API versus internal integration

CDNgine has two very different integration layers:

| Layer | Audience | What it exposes |
| --- | --- | --- |
| CDNgine public/platform/operator APIs | product clients, SDK consumers, operators | CDNgine HTTP resources and workflows |
| upstream integration adapters | internal services and workers | tus, S3, filer HTTP, Kopia CLI/server, Temporal SDK, ORAS CLI/OCI registry, Nydus runtime, Alluxio REST |

The first layer is the product contract.

The second layer is implementation plumbing and must stay behind CDNgine-owned packages and services.

## 3. Default upstream integration matrix

| Upstream system | How it runs | CDNgine consumes it through | Preferred implementation boundary |
| --- | --- | --- | --- |
| **tusd** | dedicated ingest service | tus HTTP plus hook callbacks | HTTP only; do not embed resumable-upload semantics in app code |
| **SeaweedFS S3 gateway** | stateless gateway in front of filer | S3-compatible API | `@aws-sdk/client-s3` against SeaweedFS buckets for staging and derived blobs |
| **SeaweedFS filer** | internal metadata and path service | filer HTTP API | internal HTTP client for metadata, listings, and path-scoped operations when S3 is not enough |
| **Kopia repository server** | repository access proxy | authenticated repository connection | server mode for shared repository access and credential isolation |
| **Kopia CLI** | worker-local or sidecar process | `snapshot create`, `snapshot list`, `snapshot restore` with JSON output where supported | controlled process boundary wrapped by a CDNgine adapter |
| **Temporal** | workflow service plus worker processes | official TypeScript SDK | `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow` in-process |
| **ORAS / OCI registry** | OCI registry plus ORAS client | ORAS CLI and OCI registry APIs | controlled ORAS CLI boundary first; avoid inventing a custom artifact registry |
| **Nydus** | worker-local runtime / mount layer | runtime mount or lazy-read path | host or sidecar managed by workers; not a public SDK dependency |
| **Alluxio** | optional cache / proxy service | S3 API for data and REST API for admin actions | optional node-local or near-worker cache service |

## 4. Concrete integration choices

### 4.1 tusd

CDNgine should use tusd as a **separate ingest subsystem**.

What CDNgine uses:

- the public tus HTTP protocol for browser and SDK uploads
- hook integration for upload metadata validation and completion signaling
- object-storage-backed persistence for staged uploads

What CDNgine should not do:

- implement its own chunk upload protocol
- embed resumability logic inside normal API route handlers

### 4.2 SeaweedFS

CDNgine should use **SeaweedFS in two modes**:

1. **S3 gateway** for staging and derived object I/O
2. **filer HTTP API** for internal metadata-oriented operations that are easier through filer semantics than through S3 alone

Primary TypeScript integration:

- use the standard S3 client stack against SeaweedFS's S3-compatible API for:
  - staging object writes and reads
  - derived artifact publication
  - signed URL or object-head style operations
  - multipart upload and range-friendly reads where relevant

Internal admin integration:

- use filer HTTP only for:
  - controlled path listings
  - metadata inspection
  - path-specific operational flows where the S3 gateway is not the right tool

### 4.3 Kopia

CDNgine should consume **Kopia as the source-repository product**, not recreate repository behavior in TypeScript.

Preferred posture:

- run **Kopia repository server** where shared authenticated access is needed
- wrap the **Kopia CLI** in a source-repository adapter for worker-side operations

The first commands CDNgine should rely on are:

- `kopia snapshot create ... --json`
- `kopia snapshot list ... --json`
- `kopia snapshot restore ...`

That means CDNgine owns:

- preparing the local or mounted input path for a snapshot
- mapping registry identity to Kopia snapshot identity
- parsing command output and surfacing typed failures

It does **not** own:

- chunking
- snapshot packing
- deduplication
- repository maintenance
- restore tree semantics

### 4.4 Temporal

Temporal is the cleanest integration story in the stack because CDNgine can consume it directly through the **official TypeScript SDK**.

Use:

- `@temporalio/client` from API and operator services
- `@temporalio/workflow` for workflow definitions
- `@temporalio/worker` for worker bootstrapping and activity registration

Temporal is not a sidecar boundary. It is a first-class TypeScript dependency in the service codebase.

### 4.5 ORAS

CDNgine should consume **ORAS as the artifact-graph client** and an OCI registry as the storage target.

Current default posture:

- use **ORAS CLI** from controlled worker or publication jobs
- publish manifests, bundles, and related artifact graphs into a standards-compliant OCI registry
- record registry reference, digest, media types, and attached descriptors in the CDNgine registry

CDNgine should not invent:

- its own artifact-push protocol
- its own artifact graph format when OCI references and media types are enough

### 4.6 Nydus

CDNgine should use **Nydus as a runtime/filesystem layer**, not as a new public API surface.

That means:

- workers or dedicated nodes may prepare and mount Nydus-backed lazy-readable assets
- CDNgine records the lazy-read-capable artifact identity and policy
- trusted internal clients or workers may use that path when the asset class benefits from it

CDNgine should not implement a custom lazy filesystem in userland code.

### 4.7 Alluxio

Alluxio is optional and should only appear where hot-read pressure justifies it.

When enabled:

- use **S3 API** for data paths when that fits the deployment
- use **REST API** only for admin or mount-like operations
- place the proxy close to workers because the proxy adds an extra hop

Alluxio is a cache/control optimization, not business truth.

## 5. CDNgine-owned adapter interfaces

The repo should keep all upstream integrations behind CDNgine-owned interfaces such as:

```ts
interface StagingBlobStore {
  createMultipartUploadTarget(input: CreateUploadTargetInput): Promise<CreateUploadTargetResult>
  headObject(input: HeadObjectInput): Promise<HeadObjectResult>
  deleteObject(input: DeleteObjectInput): Promise<void>
}

interface SourceRepository {
  snapshotFromPath(input: SnapshotFromPathInput): Promise<SnapshotResult>
  listSnapshots(input: ListSnapshotsInput): Promise<SnapshotSummary[]>
  restoreToPath(input: RestoreSnapshotInput): Promise<RestoreResult>
}

interface ArtifactPublisher {
  pushBundle(input: PushBundleInput): Promise<ArtifactReference>
  pullBundle(input: PullBundleInput): Promise<PulledArtifact>
}

interface LazyReadController {
  prepareLazyRead(input: PrepareLazyReadInput): Promise<LazyReadHandle>
}
```

These interfaces are where CDNgine-specific policy, retry behavior, tracing, and typed errors belong.

They are **not** where upstream protocols should be reinvented.

## 6. End-to-end flows and the APIs they use

### 6.1 Upload and canonicalization

1. client calls `POST /v1/upload-sessions`
2. CDNgine returns a tus upload target
3. client uploads through **tusd** over HTTP
4. tusd stores staged bytes in **SeaweedFS S3** using object storage semantics
5. client or hook calls upload completion
6. CDNgine verifies the staged object through **S3 HEAD/GET** style operations
7. a source adapter materializes the staged object into controlled local or mounted input
8. CDNgine invokes **Kopia** to create the canonical snapshot
9. CDNgine stores the resulting snapshot identity in PostgreSQL and starts **Temporal**

### 6.2 Processing and publication

1. Temporal schedules an activity in a worker
2. worker resolves source identity from the registry
3. worker restores from **Kopia** into scratch or prepares a **Nydus** lazy-read path
4. processor produces derivatives
5. worker writes browser-facing outputs to the **derived S3 store**
6. worker publishes immutable bundles and graphs through **ORAS**
7. worker records derivative keys and ORAS references in PostgreSQL

### 6.3 Source download

1. client calls `POST /v1/assets/{assetId}/versions/{versionId}/source/authorize`
2. CDNgine resolves policy and source identity
3. service chooses one mode:
   - proxy bytes from a **Kopia restore**
   - return a trusted internal lazy-read handle backed by **Nydus**
   - materialize an export into the delivery plane

## 7. SDK posture

### 7.1 Public SDKs

Public SDKs should expose only **CDNgine APIs**:

- `uploadSessions.create`
- `uploadSessions.complete`
- `assets.get`
- `assets.waitForVersion`
- `versions.authorizeSourceDownload`
- `manifests.get`
- `deliveries.authorize`

They should **not** ask product developers to:

- talk to Kopia directly
- call SeaweedFS or filer APIs directly
- use ORAS directly
- mount Nydus directly
- operate Temporal directly

### 7.2 Internal platform adapters

Internal CDNgine services and workers may consume:

- S3 APIs
- filer HTTP
- Kopia CLI/server
- Temporal TypeScript SDK
- ORAS CLI / OCI registry
- Nydus runtime hooks
- Alluxio REST where enabled

Those are platform-internal integration contracts, not public product SDK contracts.

## 8. Implementation rule of thumb

When choosing how to connect a new component, prefer this order:

1. official TypeScript SDK
2. stable HTTP, S3, or OCI protocol
3. official CLI wrapped in a controlled adapter
4. sidecar process that exposes a thin CDNgine-owned boundary

Do **not** skip to "reimplement the product semantics in app code".

## 9. References

- [tusd configuration and hooks](https://tus.github.io/tusd/getting-started/configuration/)
- [SeaweedFS filer HTTP API](https://github.com/seaweedfs/seaweedfs/wiki/Filer-Server-API)
- [SeaweedFS Amazon S3 API](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
- [Kopia repository server](https://kopia.io/docs/repository-server/)
- [Kopia snapshot create](https://kopia.io/docs/reference/command-line/common/snapshot-create/)
- [Kopia snapshot list](https://kopia.io/docs/reference/command-line/common/snapshot-list/)
- [Kopia snapshot restore](https://kopia.io/docs/reference/command-line/common/snapshot-restore/)
- [Temporal TypeScript SDK](https://docs.temporal.io/develop/typescript)
- [ORAS overview](https://oras.land/docs/)
- [ORAS client libraries](https://oras.land/docs/client_libraries/overview/)
- [ORAS installation](https://oras.land/docs/installation)
- [Nydus](https://nydus.dev/)
- [Alluxio REST API](https://documentation.alluxio.io/os-en/api/rest-api)
