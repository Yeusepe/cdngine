# Storage Package

This package is for canonical source-repository adapters, tiered-store and lazy-read adapters, ORAS publication helpers, derived-store adapters, and signing helpers.

The intended adapter boundaries are:

- S3-compatible clients for SeaweedFS staging and derived storage
- internal HTTP clients for SeaweedFS filer operations when needed
- controlled Kopia CLI and repository-server wrappers for source snapshots and restores
- controlled ORAS CLI wrappers for artifact publication
- runtime or sidecar control for Nydus and optional Alluxio paths

Governing docs:

- `docs/canonical-source-and-tiering-contract.md`
- `docs/upstream-integration-model.md`
- `docs/architecture.md`
- `docs/technology-profile.md`
