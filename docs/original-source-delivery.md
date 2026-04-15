# Original Source Delivery

This document defines how clients obtain the canonical original asset when they need the source version itself rather than a published derivative.

The platform has two delivery modes:

1. **published delivery** for thumbnails, streams, normalized documents, and other generated artifacts
2. **original-source delivery** for the exact canonical uploaded asset

Those are related, but they are not the same path.

## 1. Default rule

The default architecture is:

- published derivatives are served from the **derived store + CDN**
- canonical originals live in **Xet**
- clients do **not** talk to Xet directly as a broad public interface

That means original delivery is an **API-authorized operation over the canonical source**, not the same thing as derivative delivery.

## 2. Original-source delivery flow

When a caller needs the original source asset:

1. the caller requests source-download authorization from the API
2. the API verifies scope, policy, and asset lifecycle state
3. the service resolves the canonical Xet identity for the version
4. the service returns one of the supported source-delivery modes

## 3. Supported source-delivery modes

The service may satisfy original delivery through one of these modes:

### 3.1 Proxied reconstruction

The service reconstructs the file from Xet and streams it through a controlled API or download proxy.

### 3.2 Authorized Xet-backed read

The service issues a tightly scoped, short-lived read capability for the canonical Xet-backed object or reconstruction path.

### 3.3 Materialized source export

The service materializes the canonical original into a delivery scope and serves it through the derived delivery plane.

This is still sourced from Xet. It does not make the staging object or raw underlying storage key canonical.

## 4. Public API posture

The preferred public contract is:

- `POST /v1/assets/{assetId}/versions/{versionId}/source/authorize`

The response should include:

- `authorizationMode`
- `downloadMode` such as `proxy`, `xet-read`, or `materialized-export`
- `expiresAt`
- the URL or handle needed by the caller

## 5. Policy rules

Original-source delivery should be stricter than derivative delivery when policy requires it.

Examples:

- a user may be allowed to view a thumbnail but not download the source PSD or ZIP
- an organization may permit published stream playback but not source-master download
- quarantined versions must not allow source download unless policy explicitly allows forensic access

## 6. Why Xet still matters here

Xet is still the right place for originals because it provides:

- canonical file identity
- deterministic reconstruction of the exact source file
- chunk-level deduplication across revisions
- replay-safe provenance

Original delivery should therefore start from **Xet identity**, even when the final client-facing response comes through a proxy or a materialized export.

## 7. Read more

- [README](../README.md)
- [Architecture](./architecture.md)
- [Service Architecture](./service-architecture.md)
- [API Surface](./api-surface.md)
- [Canonicalization And Xet Contract](./canonicalization-and-xet-contract.md)
- [Xet Download Protocol](https://huggingface.co/docs/xet/download-protocol)
