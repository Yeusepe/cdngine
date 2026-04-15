# Local Platform

This directory is reserved for the local bring-up of the reference stack.

The intended first vertical slice includes:

1. PostgreSQL
2. Redis
3. Temporal
4. tusd
5. one S3-compatible store for staging and derived artifacts
6. one canonicalization path into Xet
7. one deterministic publication path

The governing docs are:

- `docs/environment-and-deployment.md`
- `docs/conformance.md`
- `docs/spec-governance.md`
