# Original Source Delivery

This document defines how clients obtain the canonical original asset when they need the source version itself rather than a published derivative.

The platform has two delivery modes:

1. **published delivery** for thumbnails, streams, normalized documents, and other generated artifacts
2. **original-source delivery** for the exact canonical uploaded asset

Those are related, but they are not the same path.

## 1. Default rule

The default architecture is:

- published derivatives are served from the **derived store + CDN**
- canonical originals live in the **canonical source repository**
- clients do **not** talk to the source repository directly as a broad public interface
- the canonical original is stored **once in the source repository by default**, not duplicated into the delivery plane automatically

That means original delivery is an **API-authorized operation over the canonical source**, not the same thing as derivative delivery.

## 2. Original-source delivery flow

When a caller needs the original source asset:

1. the caller requests source-download authorization from the API
2. the API verifies scope, policy, and asset lifecycle state
3. the service resolves the canonical source identity for the version
4. the service returns one of the supported source-delivery modes

## 3. Supported source-delivery modes

The service may satisfy original delivery through one of these modes:

### 3.1 Proxied reconstruction

The service reconstructs the file from the source repository and streams it through a controlled API or download proxy.

### 3.2 Authorized lazy read

The service issues a tightly scoped, short-lived read capability for a trusted internal client that can use the platform's lazy-read path or hot cache.

This mode is for package-like or rebuildable internal reads, not for ordinary browser delivery.

### 3.3 Materialized source export

The service materializes the canonical original into a delivery scope and serves it through the derived delivery plane.

This is still sourced from the canonical repository. It does not make the staging object or raw underlying storage key canonical.

This mode is **optional**, not the default. It should be used only when repeated CDN-backed reads justify a second delivery copy of the original.

## 4. Public API posture

The preferred public contract is:

- `POST /v1/assets/{assetId}/versions/{versionId}/source/authorize`

The response should include:

- `authorizationMode`
- `downloadMode` such as `proxy`, `lazy-read`, or `materialized-export`
- `expiresAt`
- the URL or handle needed by the caller

## 4.1 How deduplication applies to what we send

The platform should distinguish three cases:

### Generic browser or plain HTTP client

- the client receives a normal byte stream
- Xet still helps because the source is reconstructed from deduplicated storage
- but the client does **not** get chunk-aware transfer deduplication across sessions

### Trusted internal SDK or tool

- the client uses a lazy-read path such as `lazy-read`
- the transfer follows the source repository's reconstruction semantics
- this is the mode that best fits build systems, package processors, and internal tools that repeatedly touch large assets

### Published derivatives through CDN

- these are ordinary published artifacts, not source-repository reconstruction reads
- efficiency comes from deterministic keys, CDN caching, compression, and immutable delivery behavior
- this is not where source-plane chunk deduplication should be expected to help

## 5. Policy rules

Original-source delivery should be stricter than derivative delivery when policy requires it.

Examples:

- a user may be allowed to view a thumbnail but not download the source PSD or ZIP
- an organization may permit published stream playback but not source-master download
- quarantined versions must not allow source download unless policy explicitly allows forensic access

## 6. Why the source repository still matters here

The source repository is still the right place for originals because it provides:

- canonical file identity
- deterministic reconstruction of the exact source file
- chunk-level deduplication across revisions
- replay-safe provenance

Original delivery should therefore start from **canonical source identity**, even when the final client-facing response comes through a proxy or a materialized export.

The strongest posture for repeated source downloads is therefore:

- store the original once in the source repository
- expose a lazy or hot-cache-backed source-download mode only for trusted internal tools that benefit from it
- keep plain browser delivery as a simpler proxy or export path when needed

## 7. Read more

- [README](../README.md)
- [Architecture](./architecture.md)
- [Service Architecture](./service-architecture.md)
- [API Surface](./api-surface.md)
- [Canonical Source And Tiering Contract](./canonical-source-and-tiering-contract.md)
- [Storage Tiering And Materialization](./storage-tiering-and-materialization.md)
