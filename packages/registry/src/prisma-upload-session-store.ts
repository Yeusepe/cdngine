/**
 * Purpose: Persists upload-session issuance and completion against the durable registry with transactional idempotency, canonicalization evidence, and workflow-dispatch handoff.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/service-architecture.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.postgresql.org/docs/current/tutorial-transactions.html
 * Tests:
 * - packages/registry/test/prisma-upload-session-store.test.mjs
 */

import { randomUUID } from 'node:crypto';

import type { ObjectChecksum, SnapshotResult, StagedObjectDescriptor } from '@cdngine/storage';

import { AssetVersionState, UploadSessionState, ValidationState, WorkflowDispatchState } from './generated/prisma/enums.js';
import { Prisma } from './generated/prisma/client.js';
import type { ServiceNamespace, TenantScope } from './generated/prisma/client.js';
import { createRegistryPrismaClient, type RegistryPrismaClient } from './prisma-client.js';

export type RegistryAssetVersionLifecycleState =
  | 'session_created'
  | 'uploaded'
  | 'canonicalizing'
  | 'canonical'
  | 'processing'
  | 'failed_validation'
  | 'failed_retryable'
  | 'quarantined';

export type RegistryUploadSessionLifecycleState =
  | 'session_created'
  | 'uploaded'
  | 'expired'
  | 'terminated'
  | 'failed_validation';

export type RegistryWorkflowDispatchState =
  | 'pending'
  | 'starting'
  | 'started'
  | 'duplicate'
  | 'failed_retryable'
  | 'failed_terminal';

export interface RegistryIssueUploadSessionInput {
  assetId?: string;
  assetOwner: string;
  callerScopeKey: string;
  checksum: ObjectChecksum;
  contentType: string;
  expiresAt: Date;
  filename: string;
  idempotencyKey: string;
  normalizedRequestHash: string;
  objectKey: string;
  serviceNamespaceId: string;
  tenantId?: string;
  byteLength: bigint;
}

export interface RegistryIssuedUploadSession {
  assetId: string;
  assetOwner: string;
  checksum: ObjectChecksum;
  contentType: string;
  expiresAt: Date;
  filename: string;
  isDuplicate: boolean;
  objectKey: string;
  serviceNamespaceId: string;
  tenantId?: string;
  uploadSessionId: string;
  versionId: string;
  versionNumber: number;
  byteLength: bigint;
}

export interface RegistryUploadSessionSummary {
  assetId: string;
  assetOwner: string;
  checksum: ObjectChecksum;
  contentType: string;
  expiresAt: Date;
  filename: string;
  objectKey: string;
  serviceNamespaceId: string;
  tenantId?: string;
  uploadSessionId: string;
  uploadSessionState: RegistryUploadSessionLifecycleState;
  versionId: string;
  versionNumber: number;
  versionState: RegistryAssetVersionLifecycleState;
  byteLength: bigint;
}

export interface RegistryVerifiedUploadStagedObject {
  byteLength: bigint;
  checksum: ObjectChecksum;
  descriptor: StagedObjectDescriptor;
  objectKey: string;
}

export interface RegistryCompleteUploadSessionInput {
  callerScopeKey: string;
  idempotencyKey: string;
  normalizedRequestHash: string;
  stagedObject: RegistryVerifiedUploadStagedObject;
  uploadSessionId: string;
  workflowTemplate?: string;
}

export interface RegistryCanonicalizationRequest {
  assetId: string;
  assetOwner: string;
  filename: string;
  serviceNamespaceId: string;
  tenantId?: string;
  uploadSessionId: string;
  versionId: string;
  versionNumber: number;
  stagedObject: RegistryVerifiedUploadStagedObject;
}

export interface RegistryWorkflowDispatchSummary {
  dispatchId: string;
  state: RegistryWorkflowDispatchState;
  workflowKey: string;
}

export interface RegistryCompletedUploadSession {
  assetId: string;
  canonicalSource: SnapshotResult;
  isDuplicate: boolean;
  uploadSessionId: string;
  versionId: string;
  versionState: Extract<RegistryAssetVersionLifecycleState, 'canonical' | 'processing'>;
  workflowDispatch: RegistryWorkflowDispatchSummary;
}

interface ReplayableUploadReference {
  assetId: string;
  uploadSessionId: string;
  versionId: string;
  workflowDispatchId?: string;
}

interface CompletionReplayRow {
  assetVersion: {
    asset: {
      id: string;
      serviceNamespace: {
        serviceNamespaceId: string;
      };
      tenantScope: {
        externalTenantId: string;
      } | null;
      assetOwner: string;
    };
    id: string;
    versionNumber: number;
    lifecycleState: string;
    sourceFilename: string;
    detectedContentType: string;
    sourceByteLength: bigint;
    sourceChecksumAlgorithm: string;
    sourceChecksumValue: string;
    repositoryEngine: string | null;
    canonicalSourceId: string | null;
    canonicalSnapshotId: string | null;
    canonicalLogicalPath: string | null;
    canonicalDigestSet: Prisma.JsonValue | null;
    canonicalLogicalByteLength: bigint | null;
    canonicalStoredByteLength: bigint | null;
    dedupeMetrics: Prisma.JsonValue | null;
    sourceReconstructionHandles: Prisma.JsonValue | null;
    sourceSubstrateHints: Prisma.JsonValue | null;
    workflowDispatches: Array<{
      id: string;
      dispatchState: string;
      workflowKey: string;
    }>;
  };
  completedAt: Date | null;
  expiresAt: Date;
  id: string;
  state: string;
}

function buildCreateOperationKey() {
  return 'upload-session:create';
}

function buildCreateNormalizedOperationKey(input: RegistryIssueUploadSessionInput) {
  return [
    'upload-session:create',
    input.serviceNamespaceId,
    input.tenantId ?? 'tenant:none',
    input.assetId ?? 'asset:new'
  ].join(':');
}

function buildCompletionOperationKey(uploadSessionId: string) {
  return `upload-session:complete:${uploadSessionId}`;
}

function buildCompletionNormalizedOperationKey(uploadSessionId: string) {
  return `upload-session:complete:${uploadSessionId}`;
}

function buildWorkflowKey(
  serviceNamespaceId: string,
  assetId: string,
  versionId: string,
  workflowTemplate: string
) {
  return `${serviceNamespaceId}:${assetId}:${versionId}:${workflowTemplate}`;
}

function asJsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asChecksumArray(value: Prisma.JsonValue | null | undefined): ObjectChecksum[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value as unknown as ObjectChecksum[];
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)])
    ) as Prisma.InputJsonObject;
  }

  return String(value);
}

function mapUploadSessionState(
  state: string
): RegistryUploadSessionLifecycleState {
  switch (state) {
    case UploadSessionState.session_created:
    case UploadSessionState.uploaded:
    case UploadSessionState.expired:
    case UploadSessionState.terminated:
    case UploadSessionState.failed_validation:
      return state;
    default:
      return 'uploaded';
  }
}

function mapVersionState(
  state: string
): RegistryAssetVersionLifecycleState {
  switch (state) {
    case AssetVersionState.session_created:
    case AssetVersionState.uploaded:
    case AssetVersionState.canonicalizing:
    case AssetVersionState.canonical:
    case AssetVersionState.processing:
    case AssetVersionState.failed_validation:
    case AssetVersionState.failed_retryable:
    case AssetVersionState.quarantined:
      return state;
    default:
      return 'processing';
  }
}

function mapCompletionVersionState(state: string): 'canonical' | 'processing' {
  return state === AssetVersionState.canonical ? 'canonical' : 'processing';
}

function canonicalSnapshotFromRow(row: CompletionReplayRow['assetVersion']): SnapshotResult {
  if (!row.repositoryEngine || !row.canonicalSourceId || !row.canonicalSnapshotId || !row.canonicalLogicalPath) {
    throw new Error(`Version "${row.id}" is missing canonical source evidence.`);
  }

  const reconstructionHandles = Array.isArray(row.sourceReconstructionHandles)
    ? (row.sourceReconstructionHandles as unknown as NonNullable<
        SnapshotResult['reconstructionHandles']
      >)
    : undefined;
  const substrateHints = row.sourceSubstrateHints
    ? (asJsonRecord(row.sourceSubstrateHints) as SnapshotResult['substrateHints'])
    : undefined;

  return {
    repositoryEngine: row.repositoryEngine as SnapshotResult['repositoryEngine'],
    canonicalSourceId: row.canonicalSourceId,
    snapshotId: row.canonicalSnapshotId,
    logicalPath: row.canonicalLogicalPath,
    digests: asChecksumArray(row.canonicalDigestSet),
    ...(row.canonicalLogicalByteLength === null
      ? {}
      : { logicalByteLength: row.canonicalLogicalByteLength }),
    ...(row.canonicalStoredByteLength === null
      ? {}
      : { storedByteLength: row.canonicalStoredByteLength }),
    ...(row.dedupeMetrics ? { dedupeMetrics: asJsonRecord(row.dedupeMetrics) ?? {} } : {}),
    ...(reconstructionHandles ? { reconstructionHandles } : {}),
    ...(substrateHints ? { substrateHints } : {})
  };
}

function buildUploadSessionSummaryFromRow(row: {
  id: string;
  state: string;
  expiresAt: Date;
  assetVersion: {
    id: string;
    versionNumber: number;
    lifecycleState: string;
    sourceFilename: string;
    detectedContentType: string;
    sourceByteLength: bigint;
    sourceChecksumAlgorithm: string;
    sourceChecksumValue: string;
    ingestObjectKey: string | null;
    asset: {
      id: string;
      assetOwner: string;
      serviceNamespace: { serviceNamespaceId: string };
      tenantScope: { externalTenantId: string } | null;
    };
  };
}): RegistryUploadSessionSummary {
  return {
    assetId: row.assetVersion.asset.id,
    assetOwner: row.assetVersion.asset.assetOwner,
    byteLength: row.assetVersion.sourceByteLength,
    checksum: {
      algorithm: row.assetVersion.sourceChecksumAlgorithm as ObjectChecksum['algorithm'],
      value: row.assetVersion.sourceChecksumValue
    },
    contentType: row.assetVersion.detectedContentType,
    expiresAt: row.expiresAt,
    filename: row.assetVersion.sourceFilename,
    objectKey: row.assetVersion.ingestObjectKey ?? row.id,
    serviceNamespaceId: row.assetVersion.asset.serviceNamespace.serviceNamespaceId,
    ...(row.assetVersion.asset.tenantScope
      ? { tenantId: row.assetVersion.asset.tenantScope.externalTenantId }
      : {}),
    uploadSessionId: row.id,
    uploadSessionState: mapUploadSessionState(row.state),
    versionId: row.assetVersion.id,
    versionNumber: row.assetVersion.versionNumber,
    versionState: mapVersionState(row.assetVersion.lifecycleState)
  };
}

export class RegistryUploadSessionIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was reused for a different upload-session request.`);
    this.name = 'RegistryUploadSessionIdempotencyConflictError';
  }
}

export class RegistryUploadSessionAssetNotFoundError extends Error {
  constructor(readonly assetId: string) {
    super(`Asset "${assetId}" does not exist.`);
    this.name = 'RegistryUploadSessionAssetNotFoundError';
  }
}

export class RegistryUploadSessionNotFoundError extends Error {
  constructor(readonly uploadSessionId: string) {
    super(`Upload session "${uploadSessionId}" does not exist.`);
    this.name = 'RegistryUploadSessionNotFoundError';
  }
}

export class RegistryUploadSessionExpiredError extends Error {
  constructor(readonly uploadSessionId: string) {
    super(`Upload session "${uploadSessionId}" expired before valid completion.`);
    this.name = 'RegistryUploadSessionExpiredError';
  }
}

export class RegistryUploadSessionNotReadyError extends Error {
  constructor(readonly uploadSessionId: string) {
    super(`Upload session "${uploadSessionId}" does not have durable staged bytes yet.`);
    this.name = 'RegistryUploadSessionNotReadyError';
  }
}

export class RegistryUploadSessionInvalidStateTransitionError extends Error {
  constructor(readonly uploadSessionId: string, readonly state: string) {
    super(`Upload session "${uploadSessionId}" cannot complete from state "${state}".`);
    this.name = 'RegistryUploadSessionInvalidStateTransitionError';
  }
}

export class RegistryUploadSessionValidationFailedError extends Error {
  constructor(
    readonly uploadSessionId: string,
    readonly problemType:
      | 'https://docs.cdngine.dev/problems/checksum-mismatch'
      | 'https://docs.cdngine.dev/problems/validation-failed',
    message: string
  ) {
    super(message);
    this.name = 'RegistryUploadSessionValidationFailedError';
  }
}

export class RegistryUploadSessionCanonicalizationFailedError extends Error {
  constructor(readonly uploadSessionId: string, cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : `Canonicalization failed for upload session "${uploadSessionId}".`
    );
    this.name = 'RegistryUploadSessionCanonicalizationFailedError';
    this.cause = cause;
  }
}

export class PrismaUploadSessionStore {
  constructor(
    private readonly options: {
      now?: () => Date;
      prisma?: RegistryPrismaClient;
    } = {}
  ) {}

  private get prisma() {
    return this.options.prisma ?? createRegistryPrismaClient();
  }

  private currentNow() {
    return this.options.now?.() ?? new Date();
  }

  async issueUploadSession(input: RegistryIssueUploadSessionInput): Promise<RegistryIssuedUploadSession> {
    const existingIdempotencyRecord = await this.prisma.idempotencyRecord.findUnique({
      where: {
        apiSurface_callerScopeKey_operationKey_idempotencyKey: {
          apiSurface: 'public',
          callerScopeKey: input.callerScopeKey,
          idempotencyKey: input.idempotencyKey,
          operationKey: buildCreateOperationKey()
        }
      }
    });

    if (existingIdempotencyRecord) {
      if (existingIdempotencyRecord.normalizedRequestHash !== input.normalizedRequestHash) {
        throw new RegistryUploadSessionIdempotencyConflictError(input.idempotencyKey);
      }

      return {
        ...(await this.loadIssuedUploadSessionReplay(existingIdempotencyRecord.responseReference)),
        isDuplicate: true
      };
    }

    const now = this.currentNow();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const namespace = await tx.serviceNamespace.findUnique({
          where: { serviceNamespaceId: input.serviceNamespaceId }
        });

        if (!namespace) {
          throw new RegistryUploadSessionAssetNotFoundError(input.assetId ?? input.serviceNamespaceId);
        }

        const tenant = await this.resolveTenant(tx, namespace, input.tenantId);
        const asset =
          input.assetId === undefined
            ? await tx.asset.create({
                data: {
                  assetOwner: input.assetOwner,
                  lookupKey: randomUUID(),
                  serviceNamespaceId: namespace.id,
                  ...(tenant ? { tenantScopeId: tenant.id } : {})
                }
              })
            : await this.loadExistingAsset(tx, input.assetId, namespace, tenant, input.assetOwner);

        const latestVersion = await tx.assetVersion.findFirst({
          where: { assetId: asset.id },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true }
        });
        const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
        const version = await tx.assetVersion.create({
          data: {
            assetId: asset.id,
            detectedContentType: input.contentType,
            ingestObjectKey: input.objectKey,
            lifecycleState: AssetVersionState.session_created,
            sourceByteLength: input.byteLength,
            sourceChecksumAlgorithm: input.checksum.algorithm,
            sourceChecksumValue: input.checksum.value,
            sourceFilename: input.filename,
            versionNumber
          }
        });
        const uploadSession = await tx.uploadSession.create({
          data: {
            assetVersionId: version.id,
            expiresAt: input.expiresAt,
            expectedByteLength: input.byteLength,
            expectedChecksumAlgorithm: input.checksum.algorithm,
            expectedChecksumValue: input.checksum.value,
            firstActivityAt: now,
            ingestHandle: input.objectKey,
            stagedObjectKey: input.objectKey,
            state: UploadSessionState.session_created
          }
        });

        await tx.idempotencyRecord.create({
          data: {
            apiSurface: 'public',
            callerScopeKey: input.callerScopeKey,
            completedAt: now,
            idempotencyKey: input.idempotencyKey,
            isTerminal: true,
            normalizedOperationKey: buildCreateNormalizedOperationKey(input),
            normalizedRequestHash: input.normalizedRequestHash,
            operationKey: buildCreateOperationKey(),
            responseReference: {
              assetId: asset.id,
              uploadSessionId: uploadSession.id,
              versionId: version.id
            }
          }
        });

        return {
          assetId: asset.id,
          assetOwner: input.assetOwner,
          byteLength: input.byteLength,
          checksum: input.checksum,
          contentType: input.contentType,
          expiresAt: input.expiresAt,
          filename: input.filename,
          isDuplicate: false,
          objectKey: input.objectKey,
          serviceNamespaceId: namespace.serviceNamespaceId,
          ...(tenant ? { tenantId: tenant.externalTenantId } : {}),
          uploadSessionId: uploadSession.id,
          versionId: version.id,
          versionNumber
        };
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const replayRecord = await this.prisma.idempotencyRecord.findUnique({
          where: {
            apiSurface_callerScopeKey_operationKey_idempotencyKey: {
              apiSurface: 'public',
              callerScopeKey: input.callerScopeKey,
              idempotencyKey: input.idempotencyKey,
              operationKey: buildCreateOperationKey()
            }
          }
        });

        if (replayRecord) {
          if (replayRecord.normalizedRequestHash !== input.normalizedRequestHash) {
            throw new RegistryUploadSessionIdempotencyConflictError(input.idempotencyKey);
          }

          return {
            ...(await this.loadIssuedUploadSessionReplay(replayRecord.responseReference)),
            isDuplicate: true
          };
        }
      }

      throw error;
    }
  }

  async getUploadSession(uploadSessionId: string): Promise<RegistryUploadSessionSummary | null> {
    const row = await this.prisma.uploadSession.findUnique({
      where: { id: uploadSessionId },
      include: {
        assetVersion: {
          include: {
            asset: {
              include: {
                serviceNamespace: { select: { serviceNamespaceId: true } },
                tenantScope: { select: { externalTenantId: true } }
              }
            }
          }
        }
      }
    });

    return row ? buildUploadSessionSummaryFromRow(row) : null;
  }

  async completeUploadSession(
    input: RegistryCompleteUploadSessionInput,
    canonicalize: (
      request: RegistryCanonicalizationRequest
    ) => Promise<SnapshotResult>
  ): Promise<RegistryCompletedUploadSession> {
    const existingIdempotencyRecord = await this.prisma.idempotencyRecord.findUnique({
      where: {
        apiSurface_callerScopeKey_operationKey_idempotencyKey: {
          apiSurface: 'public',
          callerScopeKey: input.callerScopeKey,
          idempotencyKey: input.idempotencyKey,
          operationKey: buildCompletionOperationKey(input.uploadSessionId)
        }
      }
    });

    if (existingIdempotencyRecord) {
      if (existingIdempotencyRecord.normalizedRequestHash !== input.normalizedRequestHash) {
        throw new RegistryUploadSessionIdempotencyConflictError(input.idempotencyKey);
      }

      return {
        ...(await this.loadCompletionReplay(existingIdempotencyRecord.responseReference)),
        isDuplicate: true
      };
    }

    const phaseOne = await this.prisma.$transaction(async (tx) => {
      const uploadSession = await tx.uploadSession.findUnique({
        where: { id: input.uploadSessionId },
        include: {
          assetVersion: {
            include: {
              asset: {
                include: {
                  serviceNamespace: { select: { serviceNamespaceId: true } },
                  tenantScope: { select: { externalTenantId: true } }
                }
              },
              workflowDispatches: {
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { id: true, dispatchState: true, workflowKey: true }
              }
            }
          }
        }
      });

      if (!uploadSession) {
        throw new RegistryUploadSessionNotFoundError(input.uploadSessionId);
      }

      if (this.currentNow().getTime() > uploadSession.expiresAt.getTime()) {
        await tx.uploadSession.update({
          where: { id: uploadSession.id },
          data: { state: UploadSessionState.expired, terminalReason: 'expired-before-completion' }
        });
        throw new RegistryUploadSessionExpiredError(input.uploadSessionId);
      }

      const version = uploadSession.assetVersion;
      const persistedReplay = this.tryBuildCompletionReplay({
        assetVersion: version,
        completedAt: uploadSession.completedAt,
        expiresAt: uploadSession.expiresAt,
        id: uploadSession.id,
        state: uploadSession.state
      });

      if (persistedReplay) {
        await this.persistCompletionIdempotencyRecord(tx, {
          callerScopeKey: input.callerScopeKey,
          idempotencyKey: input.idempotencyKey,
          normalizedRequestHash: input.normalizedRequestHash,
          replay: persistedReplay
        });

        return {
          replay: {
            ...persistedReplay,
            isDuplicate: true
          }
        };
      }

      if (
        uploadSession.state === UploadSessionState.terminated ||
        uploadSession.state === UploadSessionState.failed_validation
      ) {
        throw new RegistryUploadSessionInvalidStateTransitionError(
          input.uploadSessionId,
          uploadSession.state
        );
      }

      if (
        version.lifecycleState !== AssetVersionState.session_created &&
        version.lifecycleState !== AssetVersionState.uploaded &&
        version.lifecycleState !== AssetVersionState.failed_retryable
      ) {
        throw new RegistryUploadSessionInvalidStateTransitionError(
          input.uploadSessionId,
          version.lifecycleState
        );
      }

      if (input.stagedObject.objectKey !== (uploadSession.stagedObjectKey ?? version.ingestObjectKey)) {
        return {
          validationFailure: await this.recordValidationFailure(
          tx,
          uploadSession.id,
          version.id,
          'https://docs.cdngine.dev/problems/validation-failed',
          `Upload session "${input.uploadSessionId}" expected staged object "${uploadSession.stagedObjectKey ?? version.ingestObjectKey ?? 'unknown'}" but received "${input.stagedObject.objectKey}".`
          )
        };
      }

      if (input.stagedObject.byteLength !== version.sourceByteLength) {
        return {
          validationFailure: await this.recordValidationFailure(
          tx,
          uploadSession.id,
          version.id,
          'https://docs.cdngine.dev/problems/validation-failed',
          `Upload session "${input.uploadSessionId}" expected ${version.sourceByteLength} byte(s) but staged validation observed ${input.stagedObject.byteLength} byte(s).`
          )
        };
      }

      const descriptorChecksum = input.stagedObject.descriptor.checksum;
      if (
        input.stagedObject.checksum.algorithm !== version.sourceChecksumAlgorithm ||
        input.stagedObject.checksum.value !== version.sourceChecksumValue ||
        !descriptorChecksum ||
        descriptorChecksum.algorithm !== version.sourceChecksumAlgorithm ||
        descriptorChecksum.value !== version.sourceChecksumValue
      ) {
        return {
          validationFailure: await this.recordValidationFailure(
          tx,
          uploadSession.id,
          version.id,
          'https://docs.cdngine.dev/problems/checksum-mismatch',
          `Upload session "${input.uploadSessionId}" did not match the expected checksum evidence.`
          )
        };
      }

      await tx.uploadSession.update({
        where: { id: uploadSession.id },
        data: {
          completedAt: this.currentNow(),
          lastActivityAt: this.currentNow(),
          stagedObjectKey: input.stagedObject.objectKey,
          state: UploadSessionState.uploaded
        }
      });
      await tx.assetVersion.update({
        where: { id: version.id },
        data: {
          ingestObjectKey: input.stagedObject.objectKey,
          lifecycleState: AssetVersionState.canonicalizing
        }
      });

      return {
        request: {
          assetId: version.asset.id,
          assetOwner: version.asset.assetOwner,
          filename: version.sourceFilename,
          serviceNamespaceId: version.asset.serviceNamespace.serviceNamespaceId,
          ...(version.asset.tenantScope
            ? { tenantId: version.asset.tenantScope.externalTenantId }
            : {}),
          uploadSessionId: uploadSession.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          stagedObject: input.stagedObject
        }
      };
    });

    if ('replay' in phaseOne) {
      return phaseOne.replay;
    }

    if ('validationFailure' in phaseOne) {
      throw phaseOne.validationFailure;
    }

    const workflowTemplate = input.workflowTemplate ?? 'asset-derivation-v1';

    try {
      const canonicalSource = await canonicalize(phaseOne.request);

      return await this.prisma.$transaction(async (tx) => {
        const uploadSession = await tx.uploadSession.findUnique({
          where: { id: input.uploadSessionId },
          include: {
            assetVersion: {
              include: {
                asset: {
                  include: {
                    serviceNamespace: { select: { serviceNamespaceId: true } },
                    tenantScope: { select: { externalTenantId: true } }
                  }
                },
                workflowDispatches: {
                  orderBy: { createdAt: 'asc' },
                  take: 1,
                  select: { id: true, dispatchState: true, workflowKey: true }
                }
              }
            }
          }
        });

        if (!uploadSession) {
          throw new RegistryUploadSessionNotFoundError(input.uploadSessionId);
        }

        const replay = this.tryBuildCompletionReplay({
          assetVersion: uploadSession.assetVersion,
          completedAt: uploadSession.completedAt,
          expiresAt: uploadSession.expiresAt,
          id: uploadSession.id,
          state: uploadSession.state
        });

        if (replay) {
          await this.persistCompletionIdempotencyRecord(tx, {
            callerScopeKey: input.callerScopeKey,
            idempotencyKey: input.idempotencyKey,
            normalizedRequestHash: input.normalizedRequestHash,
            replay
          });

          return {
            ...replay,
            isDuplicate: true
          };
        }

        if (uploadSession.assetVersion.lifecycleState !== AssetVersionState.canonicalizing) {
          throw new RegistryUploadSessionInvalidStateTransitionError(
            input.uploadSessionId,
            uploadSession.assetVersion.lifecycleState
          );
        }

        await tx.assetVersion.update({
          where: { id: uploadSession.assetVersion.id },
          data: {
            canonicalDigestSet: toJsonValue(canonicalSource.digests),
            canonicalLogicalByteLength: canonicalSource.logicalByteLength ?? null,
            canonicalLogicalPath: canonicalSource.logicalPath,
            canonicalSnapshotId: canonicalSource.snapshotId,
            canonicalSourceId: canonicalSource.canonicalSourceId,
            canonicalStoredByteLength: canonicalSource.storedByteLength ?? null,
            dedupeMetrics: canonicalSource.dedupeMetrics
              ? toJsonValue(canonicalSource.dedupeMetrics)
              : Prisma.JsonNull,
            lifecycleState: AssetVersionState.canonical,
            repositoryEngine: canonicalSource.repositoryEngine,
            sourceReconstructionHandles: canonicalSource.reconstructionHandles
              ? toJsonValue(canonicalSource.reconstructionHandles)
              : Prisma.JsonNull,
            sourceSubstrateHints: canonicalSource.substrateHints
              ? toJsonValue(canonicalSource.substrateHints)
              : Prisma.JsonNull,
            validationState: ValidationState.passed
          }
        });
        await tx.asset.update({
          where: { id: uploadSession.assetVersion.asset.id },
          data: {
            currentCanonicalVersionId: uploadSession.assetVersion.id
          }
        });

        const workflowKey = buildWorkflowKey(
          uploadSession.assetVersion.asset.serviceNamespace.serviceNamespaceId,
          uploadSession.assetVersion.asset.id,
          uploadSession.assetVersion.id,
          workflowTemplate
        );
        const workflowDispatch =
          (await tx.workflowDispatch.findUnique({
            where: { workflowKey },
            select: { id: true, dispatchState: true, workflowKey: true }
          })) ??
          (await tx.workflowDispatch.create({
            data: {
              assetVersionId: uploadSession.assetVersion.id,
              dispatchReason: 'upload-complete',
              dispatchState: WorkflowDispatchState.pending,
              workflowKey,
              workflowTemplateId: workflowTemplate
            },
            select: { id: true, dispatchState: true, workflowKey: true }
          }));

        await tx.auditEvent.create({
          data: {
            actorType: 'system',
            assetId: uploadSession.assetVersion.asset.id,
            assetVersionId: uploadSession.assetVersion.id,
            correlationId: input.idempotencyKey,
            eventType: 'asset-version-canonicalized',
            payload: {
              canonicalSourceId: canonicalSource.canonicalSourceId,
              repositoryEngine: canonicalSource.repositoryEngine,
              workflowDispatchId: workflowDispatch.id
            },
            workflowDispatchId: workflowDispatch.id
          }
        });

        const completed: RegistryCompletedUploadSession = {
          assetId: uploadSession.assetVersion.asset.id,
          canonicalSource,
          isDuplicate: false,
          uploadSessionId: uploadSession.id,
          versionId: uploadSession.assetVersion.id,
          versionState: 'canonical',
          workflowDispatch: {
            dispatchId: workflowDispatch.id,
            state: workflowDispatch.dispatchState as RegistryWorkflowDispatchState,
            workflowKey: workflowDispatch.workflowKey
          }
        };

        await this.persistCompletionIdempotencyRecord(tx, {
          callerScopeKey: input.callerScopeKey,
          idempotencyKey: input.idempotencyKey,
          normalizedRequestHash: input.normalizedRequestHash,
          replay: completed
        });

        return completed;
      });
    } catch (error) {
      await this.prisma.assetVersion.update({
        where: { id: phaseOne.request.versionId },
        data: { lifecycleState: AssetVersionState.failed_retryable }
      });

      throw new RegistryUploadSessionCanonicalizationFailedError(input.uploadSessionId, error);
    }
  }

  private async loadIssuedUploadSessionReplay(
    reference: Prisma.JsonValue | null
  ): Promise<Omit<RegistryIssuedUploadSession, 'isDuplicate'>> {
    const parsed = reference as ReplayableUploadReference | null;

    if (!parsed?.uploadSessionId || !parsed.versionId || !parsed.assetId) {
      throw new Error('Upload-session idempotency record is missing a replay reference.');
    }

    const replay = await this.getUploadSession(parsed.uploadSessionId);

    if (!replay || replay.assetId !== parsed.assetId || replay.versionId !== parsed.versionId) {
      throw new Error(
        `Upload-session replay reference for "${parsed.uploadSessionId}" no longer resolves.`
      );
    }

    return {
      assetId: replay.assetId,
      assetOwner: replay.assetOwner,
      byteLength: replay.byteLength,
      checksum: replay.checksum,
      contentType: replay.contentType,
      expiresAt: replay.expiresAt,
      filename: replay.filename,
      objectKey: replay.objectKey,
      serviceNamespaceId: replay.serviceNamespaceId,
      ...(replay.tenantId ? { tenantId: replay.tenantId } : {}),
      uploadSessionId: replay.uploadSessionId,
      versionId: replay.versionId,
      versionNumber: replay.versionNumber
    };
  }

  private async loadCompletionReplay(
    reference: Prisma.JsonValue | null
  ): Promise<Omit<RegistryCompletedUploadSession, 'isDuplicate'>> {
    const parsed = reference as ReplayableUploadReference | null;

    if (!parsed?.uploadSessionId) {
      throw new Error('Completion idempotency record is missing a replay reference.');
    }

    const uploadSession = await this.prisma.uploadSession.findUnique({
      where: { id: parsed.uploadSessionId },
      include: {
        assetVersion: {
          include: {
            asset: {
              include: {
                serviceNamespace: { select: { serviceNamespaceId: true } },
                tenantScope: { select: { externalTenantId: true } }
              }
            },
            workflowDispatches: {
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { id: true, dispatchState: true, workflowKey: true }
            }
          }
        }
      }
    });

    if (!uploadSession) {
      throw new Error(`Completion replay reference for "${parsed.uploadSessionId}" no longer resolves.`);
    }

    const replay = this.tryBuildCompletionReplay({
      assetVersion: uploadSession.assetVersion,
      completedAt: uploadSession.completedAt,
      expiresAt: uploadSession.expiresAt,
      id: uploadSession.id,
      state: uploadSession.state
    });

    if (!replay) {
      throw new Error(`Upload session "${parsed.uploadSessionId}" does not have terminal canonical evidence to replay.`);
    }

    return replay;
  }

  private tryBuildCompletionReplay(
    row: CompletionReplayRow
  ): Omit<RegistryCompletedUploadSession, 'isDuplicate'> | null {
    const dispatch = row.assetVersion.workflowDispatches[0];

    if (!dispatch || !row.assetVersion.canonicalSourceId || !row.assetVersion.canonicalSnapshotId || !row.assetVersion.repositoryEngine || !row.assetVersion.canonicalLogicalPath) {
      return null;
    }

    return {
      assetId: row.assetVersion.asset.id,
      canonicalSource: canonicalSnapshotFromRow(row.assetVersion),
      uploadSessionId: row.id,
      versionId: row.assetVersion.id,
      versionState: mapCompletionVersionState(row.assetVersion.lifecycleState),
      workflowDispatch: {
        dispatchId: dispatch.id,
        state: dispatch.dispatchState as RegistryWorkflowDispatchState,
        workflowKey: dispatch.workflowKey
      }
    };
  }

  private async persistCompletionIdempotencyRecord(
    tx: Prisma.TransactionClient,
    input: {
      callerScopeKey: string;
      idempotencyKey: string;
      normalizedRequestHash: string;
      replay: Omit<RegistryCompletedUploadSession, 'isDuplicate'>;
    }
  ) {
    await tx.idempotencyRecord.upsert({
      where: {
        apiSurface_callerScopeKey_operationKey_idempotencyKey: {
          apiSurface: 'public',
          callerScopeKey: input.callerScopeKey,
          idempotencyKey: input.idempotencyKey,
          operationKey: buildCompletionOperationKey(input.replay.uploadSessionId)
        }
      },
      update: {
        completedAt: this.currentNow(),
        isTerminal: true,
        normalizedOperationKey: buildCompletionNormalizedOperationKey(
          input.replay.uploadSessionId
        ),
        normalizedRequestHash: input.normalizedRequestHash,
        responseReference: {
          assetId: input.replay.assetId,
          uploadSessionId: input.replay.uploadSessionId,
          versionId: input.replay.versionId,
          workflowDispatchId: input.replay.workflowDispatch.dispatchId
        }
      },
      create: {
        apiSurface: 'public',
        callerScopeKey: input.callerScopeKey,
          completedAt: this.currentNow(),
        idempotencyKey: input.idempotencyKey,
        isTerminal: true,
        normalizedOperationKey: buildCompletionNormalizedOperationKey(
          input.replay.uploadSessionId
        ),
        normalizedRequestHash: input.normalizedRequestHash,
        operationKey: buildCompletionOperationKey(input.replay.uploadSessionId),
        responseReference: {
          assetId: input.replay.assetId,
          uploadSessionId: input.replay.uploadSessionId,
          versionId: input.replay.versionId,
          workflowDispatchId: input.replay.workflowDispatch.dispatchId
        }
      }
    });
  }

  private async recordValidationFailure(
    tx: Prisma.TransactionClient,
    uploadSessionId: string,
    versionId: string,
    problemType:
      | 'https://docs.cdngine.dev/problems/checksum-mismatch'
      | 'https://docs.cdngine.dev/problems/validation-failed',
    detail: string
  ): Promise<RegistryUploadSessionValidationFailedError> {
    await tx.uploadSession.update({
      where: { id: uploadSessionId },
      data: {
        state: UploadSessionState.failed_validation,
        terminalReason: problemType
      }
    });
    await tx.assetVersion.update({
      where: { id: versionId },
      data: {
        lifecycleState: AssetVersionState.failed_validation,
        validationState: ValidationState.failed
      }
    });
    await tx.validationResult.create({
      data: {
        assetVersionId: versionId,
        diagnostics: { detail },
        problemType,
        validationState: ValidationState.failed
      }
    });

    return new RegistryUploadSessionValidationFailedError(uploadSessionId, problemType, detail);
  }

  private async resolveTenant(
    tx: Prisma.TransactionClient,
    namespace: ServiceNamespace,
    tenantId: string | undefined
  ) {
    if (!tenantId) {
      return null;
    }

    return tx.tenantScope.findUnique({
      where: {
        serviceNamespaceId_externalTenantId: {
          externalTenantId: tenantId,
          serviceNamespaceId: namespace.id
        }
      }
    });
  }

  private async loadExistingAsset(
    tx: Prisma.TransactionClient,
    assetId: string,
    namespace: ServiceNamespace,
    tenant: TenantScope | null,
    assetOwner: string
  ) {
    const asset = await tx.asset.findFirst({
      where: {
        id: assetId,
        assetOwner,
        serviceNamespaceId: namespace.id,
        ...(tenant ? { tenantScopeId: tenant.id } : { tenantScopeId: null })
      }
    });

    if (!asset) {
      throw new RegistryUploadSessionAssetNotFoundError(assetId);
    }

    return asset;
  }

  private isUniqueConstraint(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
