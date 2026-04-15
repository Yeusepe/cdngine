# Local Platform

This directory is reserved for the local bring-up of the reference stack.

The intended first vertical slice includes:

1. PostgreSQL
2. Redis
3. Temporal
4. tusd
5. SeaweedFS or MinIO as the default S3-compatible substrate for staging and derived artifacts
6. one canonical source repository path using Kopia over the storage substrate
7. one ORAS-backed deterministic artifact-publication path
8. one optional Nydus or lazy-read path for package-like hot reads

The governing docs are:

- `docs/environment-and-deployment.md`
- `docs/conformance.md`
- `docs/spec-governance.md`
