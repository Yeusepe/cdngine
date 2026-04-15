-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "NamespaceLifecycleState" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "TenantScopeState" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "UploadSessionState" AS ENUM ('session_created', 'uploading', 'uploaded', 'expired', 'terminated', 'failed_validation');

-- CreateEnum
CREATE TYPE "AssetVersionState" AS ENUM ('session_created', 'uploading', 'uploaded', 'canonicalizing', 'canonical', 'processing', 'published', 'failed_validation', 'failed_retryable', 'quarantined', 'purged');

-- CreateEnum
CREATE TYPE "WorkflowDispatchState" AS ENUM ('pending', 'starting', 'started', 'duplicate', 'failed_retryable', 'failed_terminal');

-- CreateEnum
CREATE TYPE "WorkflowRunState" AS ENUM ('queued', 'running', 'waiting', 'cancelled', 'failed', 'completed');

-- CreateEnum
CREATE TYPE "ProcessingJobState" AS ENUM ('queued', 'running', 'waiting', 'cancelled', 'failed', 'completed');

-- CreateEnum
CREATE TYPE "PublicationState" AS ENUM ('pending', 'writing', 'published', 'failed_retryable', 'failed_terminal');

-- CreateEnum
CREATE TYPE "ValidationState" AS ENUM ('passed', 'failed', 'quarantined');

-- CreateEnum
CREATE TYPE "QuarantineCaseState" AS ENUM ('open', 'released', 'purged', 'closed_no_action');

-- CreateEnum
CREATE TYPE "AuthorizationFamily" AS ENUM ('delivery', 'source');

-- CreateEnum
CREATE TYPE "AuthorizationMode" AS ENUM ('public', 'signed_url', 'signed_cookie', 'proxy_url', 'internal_handle');

-- CreateEnum
CREATE TYPE "ResolvedOrigin" AS ENUM ('cdn_derived', 'origin_derived', 'manifest_bundle', 'source_export', 'source_proxy', 'lazy_read_cache');

-- CreateEnum
CREATE TYPE "ApiSurface" AS ENUM ('public', 'platform_admin', 'operator');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('system', 'caller', 'operator', 'automation');

-- CreateTable
CREATE TABLE "ServiceNamespace" (
    "id" TEXT NOT NULL,
    "serviceNamespaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "owningTeam" TEXT,
    "tenantIsolationMode" TEXT NOT NULL,
    "defaultLifecyclePolicy" JSONB,
    "metadataSchemaRegistration" JSONB,
    "lifecycleState" "NamespaceLifecycleState" NOT NULL DEFAULT 'active',
    "versionToken" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceNamespace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantScope" (
    "id" TEXT NOT NULL,
    "serviceNamespaceId" TEXT NOT NULL,
    "externalTenantId" TEXT NOT NULL,
    "state" "TenantScopeState" NOT NULL DEFAULT 'active',
    "policyOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityRegistration" (
    "id" TEXT NOT NULL,
    "serviceNamespaceId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "mediaClass" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapabilityRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeBinding" (
    "id" TEXT NOT NULL,
    "serviceNamespaceId" TEXT NOT NULL,
    "capabilityRegistrationId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopePolicyBinding" (
    "id" TEXT NOT NULL,
    "serviceNamespaceId" TEXT NOT NULL,
    "policyModelVersion" TEXT NOT NULL,
    "allowedSubjects" JSONB NOT NULL,
    "requiredAttributes" JSONB,
    "actionBindings" JSONB NOT NULL,
    "environmentRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopePolicyBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryScope" (
    "id" TEXT NOT NULL,
    "serviceNamespaceId" TEXT NOT NULL,
    "tenantScopeId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pathPrefix" TEXT,
    "authorizationMode" "AuthorizationMode" NOT NULL,
    "cacheProfile" TEXT,
    "streamBundlePolicy" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "serviceNamespaceId" TEXT NOT NULL,
    "tenantScopeId" TEXT,
    "assetOwner" TEXT NOT NULL,
    "assetClass" TEXT,
    "lookupKey" TEXT NOT NULL,
    "visibilityPolicy" JSONB,
    "retentionPolicy" JSONB,
    "currentCanonicalVersionId" TEXT,
    "publicationPointerVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "lifecycleState" "AssetVersionState" NOT NULL DEFAULT 'session_created',
    "sourceFilename" TEXT NOT NULL,
    "detectedContentType" TEXT NOT NULL,
    "sourceByteLength" BIGINT NOT NULL,
    "sourceChecksumAlgorithm" TEXT NOT NULL,
    "sourceChecksumValue" TEXT NOT NULL,
    "ingestObjectKey" TEXT,
    "canonicalSourceId" TEXT,
    "canonicalSnapshotId" TEXT,
    "canonicalLogicalPath" TEXT,
    "canonicalDigestSet" JSONB,
    "sourceDownloadPolicy" JSONB,
    "dedupeMetrics" JSONB,
    "validationState" "ValidationState",
    "versionToken" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "state" "UploadSessionState" NOT NULL DEFAULT 'session_created',
    "ingestHandle" TEXT,
    "stagedObjectKey" TEXT,
    "expectedByteLength" BIGINT NOT NULL,
    "expectedChecksumAlgorithm" TEXT NOT NULL,
    "expectedChecksumValue" TEXT NOT NULL,
    "firstActivityAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "terminalReason" TEXT,
    "versionToken" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "apiSurface" "ApiSurface" NOT NULL,
    "callerScopeKey" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "normalizedOperationKey" TEXT NOT NULL,
    "normalizedRequestHash" TEXT,
    "responseReference" JSONB,
    "responsePayload" JSONB,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationResult" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "derivativeId" TEXT,
    "validationState" "ValidationState" NOT NULL,
    "problemType" TEXT,
    "diagnostics" JSONB,
    "evidenceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDispatch" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "dispatchReason" TEXT NOT NULL,
    "dispatchState" "WorkflowDispatchState" NOT NULL DEFAULT 'pending',
    "workflowKey" TEXT NOT NULL,
    "firstAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastFailureClass" TEXT,
    "retrySummary" JSONB,
    "versionToken" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "workflowDispatchId" TEXT,
    "workflowId" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "state" "WorkflowRunState" NOT NULL DEFAULT 'queued',
    "currentPhase" TEXT,
    "waitReason" TEXT,
    "retrySummary" JSONB,
    "cancellationCause" TEXT,
    "lastOperatorAction" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "state" "ProcessingJobState" NOT NULL DEFAULT 'queued',
    "currentPhase" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "resultPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Derivative" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "deliveryScopeId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "deterministicKey" TEXT NOT NULL,
    "storageBucket" TEXT,
    "storageKey" TEXT,
    "contentType" TEXT NOT NULL,
    "byteLength" BIGINT NOT NULL,
    "checksumValue" TEXT,
    "publicationState" "PublicationState" NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Derivative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetManifest" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "deliveryScopeId" TEXT NOT NULL,
    "manifestType" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "publicationPointerVersion" INTEGER NOT NULL DEFAULT 1,
    "publicationState" "PublicationState" NOT NULL DEFAULT 'pending',
    "objectKey" TEXT NOT NULL,
    "checksumValue" TEXT,
    "manifestPayload" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAccessGrant" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "authorizationMode" "AuthorizationMode" NOT NULL,
    "resolvedOrigin" "ResolvedOrigin" NOT NULL,
    "actorScopeKey" TEXT NOT NULL,
    "exportObjectKey" TEXT,
    "proxyPath" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAuthorizationAudit" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "deliveryScopeId" TEXT,
    "sourceAccessGrantId" TEXT,
    "authorizationFamily" "AuthorizationFamily" NOT NULL,
    "authorizationMode" "AuthorizationMode" NOT NULL,
    "resolvedOrigin" "ResolvedOrigin" NOT NULL,
    "actorScopeKey" TEXT NOT NULL,
    "grantId" TEXT,
    "requestMetadata" JSONB,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryAuthorizationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "assetVersionId" TEXT,
    "workflowDispatchId" TEXT,
    "workflowRunId" TEXT,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "reason" TEXT,
    "correlationId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuarantineCase" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "state" "QuarantineCaseState" NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "openedByActorId" TEXT,
    "resolvedByActorId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "versionToken" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QuarantineCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceNamespace_serviceNamespaceId_key" ON "ServiceNamespace"("serviceNamespaceId");

-- CreateIndex
CREATE INDEX "ServiceNamespace_serviceNamespaceId_idx" ON "ServiceNamespace"("serviceNamespaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantScope_serviceNamespaceId_externalTenantId_key" ON "TenantScope"("serviceNamespaceId", "externalTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityRegistration_serviceNamespaceId_capabilityKey_sch_key" ON "CapabilityRegistration"("serviceNamespaceId", "capabilityKey", "schemaVersion");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeBinding_serviceNamespaceId_capabilityRegistrationId_r_key" ON "RecipeBinding"("serviceNamespaceId", "capabilityRegistrationId", "recipeId", "schemaVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ScopePolicyBinding_serviceNamespaceId_policyModelVersion_key" ON "ScopePolicyBinding"("serviceNamespaceId", "policyModelVersion");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryScope_serviceNamespaceId_tenantScopeId_scopeKey_key" ON "DeliveryScope"("serviceNamespaceId", "tenantScopeId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_serviceNamespaceId_tenantScopeId_lookupKey_key" ON "Asset"("serviceNamespaceId", "tenantScopeId", "lookupKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_canonicalSourceId_key" ON "AssetVersion"("canonicalSourceId");

-- CreateIndex
CREATE INDEX "AssetVersion_assetId_lifecycleState_idx" ON "AssetVersion"("assetId", "lifecycleState");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_versionNumber_key" ON "AssetVersion"("assetId", "versionNumber");

-- CreateIndex
CREATE INDEX "UploadSession_state_expiresAt_idx" ON "UploadSession"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_assetVersionId_key" ON "UploadSession"("assetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_apiSurface_callerScopeKey_operationKey_id_key" ON "IdempotencyRecord"("apiSurface", "callerScopeKey", "operationKey", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ValidationResult_assetVersionId_validationState_idx" ON "ValidationResult"("assetVersionId", "validationState");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDispatch_workflowKey_key" ON "WorkflowDispatch"("workflowKey");

-- CreateIndex
CREATE INDEX "WorkflowDispatch_dispatchState_createdAt_idx" ON "WorkflowDispatch"("dispatchState", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_workflowId_key" ON "WorkflowRun"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowRun_assetVersionId_state_idx" ON "WorkflowRun"("assetVersionId", "state");

-- CreateIndex
CREATE INDEX "ProcessingJob_workflowRunId_state_idx" ON "ProcessingJob"("workflowRunId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Derivative_deterministicKey_key" ON "Derivative"("deterministicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Derivative_assetVersionId_deliveryScopeId_recipeId_schemaVe_key" ON "Derivative"("assetVersionId", "deliveryScopeId", "recipeId", "schemaVersion", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetManifest_assetVersionId_manifestType_deliveryScopeId_key" ON "AssetManifest"("assetVersionId", "manifestType", "deliveryScopeId");

-- CreateIndex
CREATE INDEX "SourceAccessGrant_assetVersionId_expiresAt_idx" ON "SourceAccessGrant"("assetVersionId", "expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryAuthorizationAudit_authorizationFamily_grantedAt_idx" ON "DeliveryAuthorizationAudit"("authorizationFamily", "grantedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "QuarantineCase_assetVersionId_state_idx" ON "QuarantineCase"("assetVersionId", "state");

-- AddForeignKey
ALTER TABLE "TenantScope" ADD CONSTRAINT "TenantScope_serviceNamespaceId_fkey" FOREIGN KEY ("serviceNamespaceId") REFERENCES "ServiceNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityRegistration" ADD CONSTRAINT "CapabilityRegistration_serviceNamespaceId_fkey" FOREIGN KEY ("serviceNamespaceId") REFERENCES "ServiceNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeBinding" ADD CONSTRAINT "RecipeBinding_serviceNamespaceId_fkey" FOREIGN KEY ("serviceNamespaceId") REFERENCES "ServiceNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeBinding" ADD CONSTRAINT "RecipeBinding_capabilityRegistrationId_fkey" FOREIGN KEY ("capabilityRegistrationId") REFERENCES "CapabilityRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopePolicyBinding" ADD CONSTRAINT "ScopePolicyBinding_serviceNamespaceId_fkey" FOREIGN KEY ("serviceNamespaceId") REFERENCES "ServiceNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryScope" ADD CONSTRAINT "DeliveryScope_serviceNamespaceId_fkey" FOREIGN KEY ("serviceNamespaceId") REFERENCES "ServiceNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryScope" ADD CONSTRAINT "DeliveryScope_tenantScopeId_fkey" FOREIGN KEY ("tenantScopeId") REFERENCES "TenantScope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_serviceNamespaceId_fkey" FOREIGN KEY ("serviceNamespaceId") REFERENCES "ServiceNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tenantScopeId_fkey" FOREIGN KEY ("tenantScopeId") REFERENCES "TenantScope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_currentCanonicalVersionId_fkey" FOREIGN KEY ("currentCanonicalVersionId") REFERENCES "AssetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationResult" ADD CONSTRAINT "ValidationResult_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationResult" ADD CONSTRAINT "ValidationResult_derivativeId_fkey" FOREIGN KEY ("derivativeId") REFERENCES "Derivative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDispatch" ADD CONSTRAINT "WorkflowDispatch_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowDispatchId_fkey" FOREIGN KEY ("workflowDispatchId") REFERENCES "WorkflowDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Derivative" ADD CONSTRAINT "Derivative_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Derivative" ADD CONSTRAINT "Derivative_deliveryScopeId_fkey" FOREIGN KEY ("deliveryScopeId") REFERENCES "DeliveryScope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetManifest" ADD CONSTRAINT "AssetManifest_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetManifest" ADD CONSTRAINT "AssetManifest_deliveryScopeId_fkey" FOREIGN KEY ("deliveryScopeId") REFERENCES "DeliveryScope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccessGrant" ADD CONSTRAINT "SourceAccessGrant_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAuthorizationAudit" ADD CONSTRAINT "DeliveryAuthorizationAudit_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAuthorizationAudit" ADD CONSTRAINT "DeliveryAuthorizationAudit_deliveryScopeId_fkey" FOREIGN KEY ("deliveryScopeId") REFERENCES "DeliveryScope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAuthorizationAudit" ADD CONSTRAINT "DeliveryAuthorizationAudit_sourceAccessGrantId_fkey" FOREIGN KEY ("sourceAccessGrantId") REFERENCES "SourceAccessGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workflowDispatchId_fkey" FOREIGN KEY ("workflowDispatchId") REFERENCES "WorkflowDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantineCase" ADD CONSTRAINT "QuarantineCase_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
