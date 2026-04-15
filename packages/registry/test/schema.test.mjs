import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
const migrationPath = new URL('../prisma/migrations/0001_registry_foundation/migration.sql', import.meta.url);

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
});

test('initial migration captures the core control-plane tables and uniqueness indexes', () => {
  const migration = readFileSync(migrationPath, 'utf8');

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
});
