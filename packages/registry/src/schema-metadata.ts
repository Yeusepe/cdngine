/**
 * Purpose: Exposes the documented registry model inventory and lifecycle enums that the Prisma schema must preserve.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-schema/data-model/models
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * Tests:
 * - packages/registry/test/schema.test.mjs
 */

export const registryPrismaSchemaPath = 'packages/registry/prisma/schema.prisma';

export const registryModelNames = [
  'ServiceNamespace',
  'TenantScope',
  'CapabilityRegistration',
  'RecipeBinding',
  'ScopePolicyBinding',
  'DeliveryScope',
  'Asset',
  'AssetVersion',
  'UploadSession',
  'IdempotencyRecord',
  'ValidationResult',
  'WorkflowDispatch',
  'WorkflowRun',
  'ProcessingJob',
  'Derivative',
  'AssetManifest',
  'SourceAccessGrant',
  'DeliveryAuthorizationAudit',
  'AuditEvent',
  'QuarantineCase'
] as const;

export const registryLifecycleEnums = {
  uploadSessionStates: [
    'session_created',
    'uploading',
    'uploaded',
    'expired',
    'terminated',
    'failed_validation'
  ],
  assetVersionStates: [
    'session_created',
    'uploading',
    'uploaded',
    'canonicalizing',
    'canonical',
    'processing',
    'published',
    'failed_validation',
    'failed_retryable',
    'quarantined',
    'purged'
  ],
  workflowDispatchStates: [
    'pending',
    'starting',
    'started',
    'duplicate',
    'failed_retryable',
    'failed_terminal'
  ],
  workflowRunStates: ['queued', 'running', 'waiting', 'cancelled', 'failed', 'completed'],
  publicationStates: ['pending', 'writing', 'published', 'failed_retryable', 'failed_terminal'],
  quarantineCaseStates: ['open', 'released', 'purged', 'closed_no_action']
} as const;
