# Production Deployment Profiles

This directory carries the concrete runtime-profile inputs for CDNgine's next deployment step after `deploy/local-platform/`.

The goal is not to freeze one orchestrator or one hosting product. The goal is to make the packaging choices explicit enough that the implemented lifecycle keeps the same semantics in:

1. single-node plus one-bucket
2. single-node plus multi-bucket
3. later multi-node production packaging

## Files

| File | Purpose |
| --- | --- |
| `runtime.one-bucket.env.example` | shared-bucket deployment where `ingest`, `source`, `derived`, and `exports` stay distinct by prefix |
| `runtime.multi-bucket.env.example` | split-bucket deployment where each logical role gets its own bucket plus optional prefixes |

## Runtime config surface

The storage package now resolves these environment variables into one typed logical storage layout:

- `CDNGINE_STORAGE_LAYOUT_MODE`
- `CDNGINE_STORAGE_BUCKET` for one-bucket deployments
- `CDNGINE_INGEST_BUCKET`, `CDNGINE_SOURCE_BUCKET`, `CDNGINE_DERIVED_BUCKET`, `CDNGINE_EXPORTS_BUCKET` for multi-bucket deployments
- `CDNGINE_INGEST_PREFIX`, `CDNGINE_SOURCE_PREFIX`, `CDNGINE_DERIVED_PREFIX`, `CDNGINE_EXPORTS_PREFIX`
- `CDNGINE_TIERING_SUBSTRATE`
- `CDNGINE_SOURCE_DELIVERY_MODE`
- `CDNGINE_HOT_READ_LAYER`

The observability package now resolves these readiness-profile variables:

- `CDNGINE_DEPLOYMENT_PROFILE`
- `CDNGINE_READINESS_REQUIRED`

## Secrets posture

These example files intentionally exclude secrets. Real deployments still need:

- database credentials
- Redis credentials when enabled
- Temporal credentials or mTLS material when managed Temporal is used
- object-storage access keys or IAM-based equivalents
- Kopia repository password and repository credentials
- OCI registry credentials

Keep those values outside checked-in examples and inject them through the deployment system.

## Governing docs

- `docs/environment-and-deployment.md`
- `docs/storage-tiering-and-materialization.md`
- `docs/upstream-integration-model.md`
- `docs/observability.md`
