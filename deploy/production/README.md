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

The auth and storage packages now resolve these environment variables into the checked-in runtime config surface:

- `CDNGINE_AUTH_BASE_URL`
- `CDNGINE_AUTH_SECRET`
- `CDNGINE_AUTH_TRUSTED_ORIGINS_JSON`
- `CDNGINE_AUTH_SESSION_EXPIRES_IN_SECONDS`
- `CDNGINE_AUTH_SESSION_UPDATE_AGE_SECONDS`
- `CDNGINE_AUTH_SESSION_FRESH_AGE_SECONDS`
- `CDNGINE_AUTH_DEFER_SESSION_REFRESH`
- `CDNGINE_AUTH_DISABLE_SESSION_REFRESH`
- `CDNGINE_STORAGE_LAYOUT_MODE`
- `CDNGINE_STORAGE_BUCKET` for one-bucket deployments
- `CDNGINE_INGEST_BUCKET`, `CDNGINE_SOURCE_BUCKET`, `CDNGINE_DERIVED_BUCKET`, `CDNGINE_EXPORTS_BUCKET` for multi-bucket deployments
- `CDNGINE_INGEST_PREFIX`, `CDNGINE_SOURCE_PREFIX`, `CDNGINE_DERIVED_PREFIX`, `CDNGINE_EXPORTS_PREFIX`
- `CDNGINE_TIERING_SUBSTRATE`
- `CDNGINE_SOURCE_DELIVERY_MODE`
- `CDNGINE_HOT_READ_LAYER`
- `CDNGINE_SOURCE_ENGINE`
- `CDNGINE_XET_COMMAND`, `CDNGINE_XET_COMMAND_ARGS_JSON`, `CDNGINE_XET_SERVICE_ENDPOINT`, `CDNGINE_XET_AUTH_TOKEN`, `CDNGINE_XET_WORKSPACE_PATH`, `CDNGINE_XET_WORKING_DIRECTORY`, `CDNGINE_XET_TIMEOUT_MS`
- `CDNGINE_KOPIA_EXECUTABLE`, `CDNGINE_KOPIA_WORKING_DIRECTORY`, `CDNGINE_KOPIA_TIMEOUT_MS`

The observability package now resolves these readiness-profile variables:

- `CDNGINE_DEPLOYMENT_PROFILE`
- `CDNGINE_READINESS_REQUIRED`

## Current source-plane posture

These production examples now describe the rollout contract rather than a Kopia-only steady state:

- the `source` role is the backing storage for the canonical source repository, with **Xet** as the target default engine for new canonicalizations
- the same storage-role examples also support the temporary **Kopia** dual-read migration lane for legacy versions
- the engine-neutral source-evidence fields remain a registry and diagnostics contract, not a deployment-topology change
- `CDNGINE_SOURCE_ENGINE` is an internal operator rollout control, not a product-facing API contract
- there is intentionally no public checked-in production environment variable that lets product callers choose the canonical source engine

Do not interpret these examples as permission for indefinite mixed-engine operation. **Kopia is temporary** and should be retired only after migration, any required backfill, and operator signoff confirm that no legacy versions still depend on it.

## Default-engine switch and Xet bridge posture

The checked-in production examples now show the **Xet-default** posture by omitting `CDNGINE_SOURCE_ENGINE`.

- when `CDNGINE_SOURCE_ENGINE` is absent, the runtime loader defaults new canonicalizations to **Xet**
- set `CDNGINE_SOURCE_ENGINE=kopia` only for the temporary migration lane or an emergency write-path rollback
- the currently implemented Xet runtime path is **command-backed**; provide `CDNGINE_XET_COMMAND` and any optional `CDNGINE_XET_COMMAND_ARGS_JSON`, `CDNGINE_XET_WORKSPACE_PATH`, and `CDNGINE_XET_WORKING_DIRECTORY` values needed by that bridge
- `CDNGINE_XET_SERVICE_ENDPOINT` and `CDNGINE_XET_AUTH_TOKEN` are valid inputs when the deployment chooses the service-backed Xet bridge instead of the checked-in command-backed example
- keep the Kopia executable, working directory, repository credentials, and source bucket or prefix available until migration/backfill/signoff retire every legacy `repositoryEngine = kopia` row

Before reducing the legacy lane, operators should run:

```bash
npm run source:migration -- inventory
npm run source:migration -- recanonicalize
```

The second command is a dry-run by default. Add `--apply` only when you intentionally want to restore legacy Kopia rows and snapshot them into Xet as candidate evidence without rewriting the original registry record.

## Readiness expectations

The readiness loader has two built-in profiles:

| Profile | Default required dependencies |
| --- | --- |
| `local-fast-start` | `auth`, `postgres`, `redis`, `temporal`, `tusd`, `source-repository`, `oci-registry` |
| `production-default` | `auth`, `postgres`, `redis`, `temporal`, `tusd`, `source-repository`, `derived-store`, `exports-store` |

`CDNGINE_READINESS_REQUIRED` can override either profile, but the normal production examples should still prove:

- the configured auth adapter can validate bearer-backed sessions with deployment-managed secrets and trusted origins
- the Xet bridge command is runnable within the configured timeout
- the source backing bucket or prefix is reachable for canonicalization and reconstruction
- derived and exports origins are reachable in the `production-default` profile
- the temporary Kopia lane is still restorable anywhere legacy rows or emergency rollback still depend on it

Treat `source-repository` readiness as a runtime-factory contract, not as a promise that the repo already ships a dedicated Xet service.

## Runtime verification endpoints

Production API deployments should expose:

- `/healthz`
- `/readyz`
- `/metrics`

Cutover is incomplete if those endpoints are missing or if `/readyz` is backed only by placeholder success.

## Secrets posture

These example files intentionally exclude secrets. Real deployments still need:

- database credentials
- auth secret material
- Redis credentials when enabled
- Temporal credentials or mTLS material when managed Temporal is used
- object-storage access keys or IAM-based equivalents
- Xet bridge credentials when the command wrapper or future service boundary requires them
- Kopia repository password and repository credentials during the migration period
- OCI registry credentials

Keep those values outside checked-in examples and inject them through the deployment system.

## Emergency fallback posture

If the Xet bridge is unhealthy during rollout:

1. pause or slow new canonicalizations rather than rewriting canonical evidence
2. confirm the temporary Kopia lane is still provisioned and can restore legacy rows
3. switch only the operator rollout control by setting `CDNGINE_SOURCE_ENGINE=kopia`
4. keep existing `repositoryEngine = xet` and `repositoryEngine = kopia` rows intact; do not rewrite them to raw storage coordinates
5. restore the Xet bridge, remove the override, and return to the default posture once readiness is green again

This is an operator-only rollback for new canonicalizations. It is not a public product feature and not permission to keep both engines indefinitely as equal peers.

## Governing docs

- `docs/environment-and-deployment.md`
- `docs/source-plane-strategy.md`
- `docs/adr/0012-xet-default-rollout-and-kopia-dual-read-migration.md`
- `docs/storage-tiering-and-materialization.md`
- `docs/upstream-integration-model.md`
- `docs/observability.md`
