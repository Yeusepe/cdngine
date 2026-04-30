import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
const foundationMigrationPath = new URL('../prisma/migrations/0001_registry_foundation/migration.sql', import.meta.url);
const xetEvidenceMigrationPath = new URL('../prisma/migrations/0002_asset_version_canonical_evidence/migration.sql', import.meta.url);

test('registry prisma schema models the documented lifecycle records', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  for (const modelName of [
    'ServiceNamespace',
    'TenantScope',
    'Asset',
    'AssetVersion',
    'UploadSession',
    'IdempotencyRecord',
    'WorkflowDispatch',
    'WorkflowRun',
    'ProcessingJob',
    'Derivative',
    'AssetManifest',
    'DeliveryScope',
    'DeliveryAuthorizationAudit',
    'SourceAccessGrant',
    'ValidationResult',
    'AuditEvent',
    'QuarantineCase'
  ]) {
    assert.match(schema, new RegExp(`model ${modelName} \\{`), `${modelName} should exist`);
  }
});

test('registry prisma schema preserves the critical uniqueness and handoff constraints', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  assert.match(schema, /@@unique\(\[assetId, versionNumber\]\)/, 'AssetVersion revision lineage should be unique per asset');
  assert.match(
    schema,
    /@@unique\(\[apiSurface, callerScopeKey, operationKey, idempotencyKey\]\)/,
    'IdempotencyRecord should enforce durable idempotency uniqueness'
  );
  assert.match(schema, /workflowKey\s+String\s+@unique/, 'WorkflowDispatch should enforce business-keyed uniqueness');
  assert.match(
    schema,
    /@@unique\(\[assetVersionId, manifestType, deliveryScopeId\]\)/,
    'AssetManifest should enforce one active manifest row per version, manifest type, and delivery scope'
  );
  assert.match(schema, /lifecycleState\s+AssetVersionState\s+@default\(session_created\)/, 'AssetVersion should start at session_created');
  assert.match(schema, /dispatchState\s+WorkflowDispatchState\s+@default\(pending\)/, 'WorkflowDispatch should start pending');
  assert.match(schema, /repositoryEngine\s+String\?/, 'AssetVersion should persist the canonical repository engine');
  assert.match(schema, /canonicalLogicalByteLength\s+BigInt\?/, 'AssetVersion should persist canonical logical byte length evidence');
  assert.match(schema, /canonicalStoredByteLength\s+BigInt\?/, 'AssetVersion should persist canonical stored byte length evidence');
  assert.match(schema, /sourceReconstructionHandles\s+Json\?/, 'AssetVersion should persist reconstruction handles');
  assert.match(schema, /sourceSubstrateHints\s+Json\?/, 'AssetVersion should persist substrate placement hints');
});

test('initial migration captures the core control-plane tables and uniqueness indexes', () => {
  const migration = readFileSync(foundationMigrationPath, 'utf8');

  for (const tableName of ['"Asset"', '"AssetVersion"', '"UploadSession"', '"IdempotencyRecord"', '"WorkflowDispatch"', '"AssetManifest"']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${tableName}`), `${tableName} table should exist in the migration`);
  }

  assert.match(migration, /CREATE UNIQUE INDEX "AssetVersion_assetId_versionNumber_key"/, 'migration should enforce per-asset version uniqueness');
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "IdempotencyRecord_.*" ON "IdempotencyRecord"\("apiSurface", "callerScopeKey", "operationKey", "idempotencyKey"\);/,
    'migration should enforce idempotency uniqueness'
  );
  assert.match(migration, /CREATE UNIQUE INDEX "WorkflowDispatch_workflowKey_key"/, 'migration should enforce business-keyed workflow uniqueness');
  assert.match(migration, /"canonicalSnapshotId" TEXT,/, 'initial migration should retain the original canonical snapshot column');
  assert.match(migration, /"canonicalLogicalPath" TEXT,/, 'initial migration should retain the original canonical logical path column');
  assert.doesNotMatch(migration, /"repositoryEngine" TEXT,/, 'initial migration should not inline post-foundation repository engine evidence');
  assert.doesNotMatch(migration, /"canonicalLogicalByteLength" BIGINT,/, 'initial migration should not inline post-foundation logical byte length evidence');
  assert.doesNotMatch(migration, /"canonicalStoredByteLength" BIGINT,/, 'initial migration should not inline post-foundation stored byte length evidence');
  assert.doesNotMatch(migration, /"sourceReconstructionHandles" JSONB,/, 'initial migration should not inline post-foundation reconstruction handles');
  assert.doesNotMatch(migration, /"sourceSubstrateHints" JSONB,/, 'initial migration should not inline post-foundation substrate hints');
});

test('forward migration adds the Xet rollout canonical evidence columns without rewriting 0001', () => {
  const migration = readFileSync(xetEvidenceMigrationPath, 'utf8');

  assert.match(migration, /ALTER TABLE "AssetVersion"/, 'forward migration should alter AssetVersion in place');
  assert.match(migration, /ADD COLUMN\s+"repositoryEngine"\s+TEXT/, 'forward migration should add canonical repository engine evidence');
  assert.match(migration, /ADD COLUMN\s+"canonicalLogicalByteLength"\s+BIGINT/, 'forward migration should add logical byte length evidence');
  assert.match(migration, /ADD COLUMN\s+"canonicalStoredByteLength"\s+BIGINT/, 'forward migration should add stored byte length evidence');
  assert.match(migration, /ADD COLUMN\s+"sourceReconstructionHandles"\s+JSONB/, 'forward migration should add reconstruction handles');
  assert.match(migration, /ADD COLUMN\s+"sourceSubstrateHints"\s+JSONB/, 'forward migration should add substrate hints');
  assert.doesNotMatch(migration, /ADD COLUMN\s+"canonicalSnapshotId"\s+TEXT/, 'forward migration should not re-add base canonical snapshot evidence');
});
