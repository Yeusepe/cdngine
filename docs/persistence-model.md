# Persistence Model

This document defines how CDNgine saves durable control-plane state.

The storage split is already established:

- the **canonical source repository** is the canonical source plane for originals
- **PostgreSQL** is the durable control-plane source of truth
- **derived object storage** is the durable delivery artifact store
- **Redis** is support state only

What this document adds is the write contract: which records exist, which mutations must be atomic, and how concurrency is controlled.

## 1. Durable systems of record

| System | Durable truth for |
| --- | --- |
| PostgreSQL | asset metadata, version state, workflow projection, idempotency, dispatch, manifests, audit |
| canonical source repository | canonical source identity, deduplicated content, source reconstruction |
| Derived store | published derivatives and manifest objects |
| Redis | never durable truth |

## 2. Registry records that must exist before implementation

The registry must model at least:

- `Asset`
- `AssetVersion`
- `UploadSession`
- `IdempotencyRecord`
- `WorkflowDispatch`
- `WorkflowRun`
- `ProcessingJob`
- `Derivative`
- `AssetManifest`
- `DeliveryScope`
- `DeliveryAuthorizationAudit`
- `SourceAccessGrant`
- `ValidationResult`
- `AuditEvent`
- `QuarantineCase`

## 3. Transaction boundaries

### 3.1 Upload-session creation

One transaction should:

1. authorize scope
2. create or look up the asset
3. create the new `AssetVersion`
4. create the `UploadSession`
5. create durable idempotency evidence for the mutation response

### 3.2 Upload completion acceptance

One transaction should:

1. verify the `IdempotencyRecord`
2. verify the `UploadSession`
3. move `AssetVersion` from `uploaded` to `canonicalizing`
4. persist staged-object verification evidence
5. create or update `ValidationResult` when needed

The source-repository write itself may happen outside the SQL transaction, but SQL must not claim `canonical` before snapshotting succeeds.

### 3.3 Canonicalization success

One transaction should:

1. persist the canonical source identity set
2. persist backing bucket or prefix metadata needed for operator diagnostics without treating raw object keys as public identity
3. move `AssetVersion` from `canonicalizing` to `canonical`
4. create `WorkflowDispatch` in `pending`
5. emit an `AuditEvent`

### 3.4 Publication

One transaction should:

1. upsert deterministic `Derivative` rows
2. persist manifest metadata and publication pointer updates
3. advance publication states
4. move `AssetVersion` to `published` only when required publication evidence exists

## 4. Optimistic concurrency

Mutable control-plane rows use explicit version columns or equivalent concurrency tokens.

At minimum:

- `Asset.currentCanonicalVersion`
- `Asset.publicationPointerVersion`
- `AssetManifest.activePublicationPointerVersion`
- `WorkflowDispatch`
- operator-managed records such as quarantine and purge state

Compare-and-swap updates are preferred over hidden lock-heavy request behavior.

## 5. Uniqueness and business keys

The registry should enforce:

- stable asset lookup uniqueness inside scope
- one durable idempotency result per `(surface, caller-scope, operation, idempotency-key)`
- one dispatch intent per business-keyed workflow start
- one deterministic derivative row per `(asset-version, recipe, schema-version, delivery-scope)`
- one active manifest publication pointer per `(asset-version, manifest-type, delivery-scope)`
- one durable authorization audit row per issued delivery or source-download grant when auditing is enabled

## 6. JSONB posture

JSONB is appropriate for:

- namespace-specific metadata
- processor result blobs
- manifest fragments
- structured validation diagnostics

JSONB is not an excuse to hide relational truth that needs joins, uniqueness, or lifecycle semantics.

## 7. Retention and purge

Retention rules must distinguish:

- canonical source retention in the source repository
- delivery artifact retention in the derived store
- metadata and audit retention in PostgreSQL

Purge actions record:

- actor or automation source
- legal or policy basis
- scope of deletion
- whether canonical source, derived artifacts, or control-plane metadata were removed

## 8. Recovery posture

Recovery must be driven from durable evidence:

- registry state says what should exist
- canonical source identity says what the source of replay is
- dispatch and workflow projection say whether work should be restarted

Redis may accelerate recovery, but it is never sufficient evidence on its own.

## 9. Read more

- [Domain Model](./domain-model.md)
- [State Machines](./state-machines.md)
- [Idempotency And Dispatch](./idempotency-and-dispatch.md)
- [Canonical Source And Tiering Contract](./canonical-source-and-tiering-contract.md)
- [Prisma transactions, idempotent APIs, and OCC](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
