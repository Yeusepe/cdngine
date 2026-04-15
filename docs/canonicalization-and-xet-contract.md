# Canonicalization And Xet Contract

This document defines the handoff from staged ingest bytes to canonical Xet identity.

CDNgine already distinguishes ingest staging from canonical storage. This document makes the contract implementation-grade.

## 1. Handoff boundary

The canonicalization boundary is:

`ingest-managed staged object` -> `verified source evidence` -> `Xet canonical identity`

The staged object is not canonical truth.

## 2. Required verification before canonicalization

Before a version can move from `uploaded` to `canonical`, the platform should verify:

1. authorized scope still matches the upload session
2. staged bytes exist and reported size is stable
3. required checksum evidence is present when the client or ingest profile requires it
4. file signature or sniffed content is consistent with declared class
5. filename and metadata satisfy policy
6. quarantine policy does not require immediate hold

## 3. Persisted canonical identity

When canonicalization succeeds, the registry must persist:

- Xet scope or storage domain identity
- Xet file ID or equivalent reconstruction identity
- canonical logical source path
- strong content digest such as SHA-256
- source size
- detected content type and media metadata where relevant
- canonicalization timestamp

Raw S3 object keys beneath Xet are not public or control-plane identities.

## 4. Reconstruction metadata posture

The registry does not need to duplicate Xet internals, but it must persist enough metadata to:

- explain where replay starts
- correlate canonicalization with observability and audit signals
- diagnose reconstruction failures
- prove that a published derivative came from a specific canonical source identity

## 5. Replay source rules

Replay always starts from the canonical Xet identity stored on the version record.

Replay does not start from:

- a transient staging object
- a derived artifact
- a raw underlying object-storage key

## 6. Source-side evidence retention

Selected immutable evidence may be retained alongside the canonical source when replay depends on it, for example:

- ingest verification summaries
- source-side inventory or scan evidence
- immutable normalization evidence needed to explain later derivations

This evidence remains separate from delivery artifacts and must not turn Xet into the hot delivery origin.

## 7. Failure outcomes

Canonicalization may result in:

- `canonical`
- `failed_validation`
- `failed_retryable`
- `quarantined`

Failures record problem type, diagnostics, and whether replay or release is possible later.

## 8. Worker read contract

Workers reconstruct from Xet into isolated scratch space.

Workers must not assume:

- raw S3 key stability
- public readability of canonical source data
- mutable source identity after `canonical`

## 8.1 Client source-delivery contract

When a client needs the original source asset, the service should authorize that read explicitly and resolve it from the version's canonical Xet identity.

The service may:

- proxy reconstruction from Xet
- return a tightly scoped Xet-backed read capability
- materialize a delivery export

The client should not treat staging objects or raw underlying storage keys as the canonical download contract.

## 9. Read more

- [README](../README.md)
- [Architecture](./architecture.md)
- [Service Architecture](./service-architecture.md)
- [State Machines](./state-machines.md)
- [Xet Protocol Specification](https://huggingface.co/docs/xet)
- [Xet Upload Protocol](https://huggingface.co/docs/xet/upload-protocol)
- [Using Xet Storage](https://huggingface.co/docs/hub/en/xet/using-xet-storage)
- [huggingface/xet-core](https://github.com/huggingface/xet-core)
- [tusd hooks and configuration](https://tus.github.io/tusd/getting-started/configuration/)
