/**
 * Purpose: Defines upload-session issuance and completion contracts plus a deterministic in-memory lifecycle implementation for route and idempotency tests.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/source-plane-strategy.md
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://tus.io/protocols/resumable-upload
 * Tests:
 * - apps/api/test/upload-session-routes.test.mjs
 */

import type {
  PersistedCanonicalSourceEvidence as StoragePersistedCanonicalSourceEvidence,
  ObjectChecksum,
  SnapshotResult,
  StagedObjectDescriptor
} from '@cdngine/storage';
import {
  canonicalSourceEvidenceToSnapshotResult,
  clonePersistedCanonicalSourceEvidence,
  snapshotResultToCanonicalSourceEvidence
} from '@cdngine/storage';

export type AssetVersionLifecycleState =
  | 'session_created'
  | 'uploaded'
  | 'canonicalizing'
  | 'canonical'
  | 'processing'
  | 'failed_validation'
  | 'failed_retryable'
  | 'quarantined';

export type UploadSessionLifecycleState =
  | 'session_created'
  | 'uploaded'
  | 'expired'
  | 'terminated'
  | 'failed_validation';

export type WorkflowDispatchState =
  | 'pending'
  | 'starting'
  | 'started'
  | 'duplicate'
  | 'failed_retryable'
  | 'failed_terminal';

export interface IssueUploadSessionInput {
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

export interface IssuedUploadSession {
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

export interface UploadSessionSummary {
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
  uploadSessionState: UploadSessionLifecycleState;
  versionId: string;
  versionNumber: number;
  versionState: AssetVersionLifecycleState;
  byteLength: bigint;
}

export interface VerifiedUploadStagedObject {
  byteLength: bigint;
  checksum: ObjectChecksum;
  descriptor: StagedObjectDescriptor;
  objectKey: string;
}

export interface CompleteUploadSessionInput {
  callerScopeKey: string;
  idempotencyKey: string;
  normalizedRequestHash: string;
  stagedObject: VerifiedUploadStagedObject;
  uploadSessionId: string;
  workflowTemplate?: string;
}

export interface CanonicalizationRequest {
  assetId: string;
  assetOwner: string;
  filename: string;
  serviceNamespaceId: string;
  tenantId?: string;
  uploadSessionId: string;
  versionId: string;
  versionNumber: number;
  stagedObject: VerifiedUploadStagedObject;
}

export interface WorkflowDispatchSummary {
  dispatchId: string;
  state: WorkflowDispatchState;
  workflowKey: string;
}

export type PersistedCanonicalSourceEvidence = StoragePersistedCanonicalSourceEvidence;

export interface CompletedUploadSession {
  assetId: string;
  canonicalSource: SnapshotResult;
  isDuplicate: boolean;
  uploadSessionId: string;
  versionId: string;
  versionState: Extract<AssetVersionLifecycleState, 'canonical' | 'processing'>;
  workflowDispatch: WorkflowDispatchSummary;
}

export interface UploadSessionIssuanceStore {
  issueUploadSession(input: IssueUploadSessionInput): Promise<IssuedUploadSession>;
}

export interface UploadSessionCompletionStore {
  getUploadSession(uploadSessionId: string): Promise<UploadSessionSummary | null>;
  completeUploadSession(
    input: CompleteUploadSessionInput,
    canonicalize: (request: CanonicalizationRequest) => Promise<SnapshotResult>
  ): Promise<CompletedUploadSession>;
}

export class UploadSessionIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was reused for a different upload-session request.`);
    this.name = 'UploadSessionIdempotencyConflictError';
  }
}

export class UploadSessionAssetNotFoundError extends Error {
  constructor(readonly assetId: string) {
    super(`Asset "${assetId}" does not exist.`);
    this.name = 'UploadSessionAssetNotFoundError';
  }
}

export class UploadSessionNotFoundError extends Error {
  constructor(readonly uploadSessionId: string) {
    super(`Upload session "${uploadSessionId}" does not exist.`);
    this.name = 'UploadSessionNotFoundError';
  }
}

export class UploadSessionExpiredError extends Error {
  constructor(readonly uploadSessionId: string) {
    super(`Upload session "${uploadSessionId}" expired before valid completion.`);
    this.name = 'UploadSessionExpiredError';
  }
}

export class UploadSessionNotReadyError extends Error {
  constructor(readonly uploadSessionId: string) {
    super(`Upload session "${uploadSessionId}" does not have durable staged bytes yet.`);
    this.name = 'UploadSessionNotReadyError';
  }
}

export class UploadSessionInvalidStateTransitionError extends Error {
  constructor(readonly uploadSessionId: string, readonly state: string) {
    super(`Upload session "${uploadSessionId}" cannot complete from state "${state}".`);
    this.name = 'UploadSessionInvalidStateTransitionError';
  }
}

export class UploadSessionValidationFailedError extends Error {
  constructor(
    readonly uploadSessionId: string,
    readonly problemType:
      | 'https://docs.cdngine.dev/problems/checksum-mismatch'
      | 'https://docs.cdngine.dev/problems/validation-failed',
    message: string
  ) {
    super(message);
    this.name = 'UploadSessionValidationFailedError';
  }
}

export class UploadSessionCanonicalizationFailedError extends Error {
  constructor(readonly uploadSessionId: string, cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : `Canonicalization failed for upload session "${uploadSessionId}".`
    );
    this.name = 'UploadSessionCanonicalizationFailedError';
    this.cause = cause;
  }
}

interface AssetSummary {
  assetId: string;
  assetOwner: string;
  serviceNamespaceId: string;
  tenantId?: string;
}

interface VersionRecord extends Omit<IssuedUploadSession, 'expiresAt' | 'isDuplicate' | 'uploadSessionId'> {
  canonicalSourceEvidence?: PersistedCanonicalSourceEvidence;
  lifecycleState: AssetVersionLifecycleState;
  workflowDispatch?: WorkflowDispatchSummary;
}

interface UploadSessionRecord {
  assetId: string;
  checksum: ObjectChecksum;
  contentType: string;
  expiresAt: Date;
  filename: string;
  objectKey: string;
  serviceNamespaceId: string;
  tenantId?: string;
  uploadSessionId: string;
  versionId: string;
  uploadSessionState: UploadSessionLifecycleState;
  completionRequestHash?: string;
  completionResult?: Omit<CompletedUploadSession, 'isDuplicate'>;
}

export interface InMemoryUploadSessionIssuanceStoreOptions {
  generateId?: (prefix: 'ast' | 'ver' | 'upl' | 'wd') => string;
  now?: () => Date;
}

function buildOperationIdempotencyKey(
  callerScopeKey: string,
  operation: 'upload-session:create' | 'upload-session:complete',
  idempotencyKey: string
) {
  return `${callerScopeKey}:${operation}:${idempotencyKey}`;
}

function buildWorkflowKey(
  serviceNamespaceId: string,
  assetId: string,
  versionId: string,
  workflowTemplate: string
) {
  return `${serviceNamespaceId}:${assetId}:${versionId}:${workflowTemplate}`;
}

export class InMemoryUploadSessionIssuanceStore
  implements UploadSessionIssuanceStore, UploadSessionCompletionStore
{
  private readonly assets = new Map<string, AssetSummary>();
  private readonly versionsById = new Map<string, VersionRecord>();
  private readonly versionsByAssetId = new Map<string, string[]>();
  private readonly uploadSessions = new Map<string, UploadSessionRecord>();
  private readonly idempotencyRecords = new Map<
    string,
    {
      normalizedRequestHash: string;
      result: IssuedUploadSession | Omit<CompletedUploadSession, 'isDuplicate'>;
    }
  >();
  private readonly generateId: (prefix: 'ast' | 'ver' | 'upl' | 'wd') => string;
  private readonly now: () => Date;

  constructor(options: InMemoryUploadSessionIssuanceStoreOptions = {}) {
    this.generateId =
      options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 26)}`);
    this.now = options.now ?? (() => new Date());
  }

  async issueUploadSession(input: IssueUploadSessionInput): Promise<IssuedUploadSession> {
    const idempotencyScopeKey = buildOperationIdempotencyKey(
      input.callerScopeKey,
      'upload-session:create',
      input.idempotencyKey
    );
    const existingIdempotencyRecord = this.idempotencyRecords.get(idempotencyScopeKey);

    if (existingIdempotencyRecord) {
      if (existingIdempotencyRecord.normalizedRequestHash !== input.normalizedRequestHash) {
        throw new UploadSessionIdempotencyConflictError(input.idempotencyKey);
      }

      return {
        ...(existingIdempotencyRecord.result as IssuedUploadSession),
        isDuplicate: true
      };
    }

    const asset = this.resolveOrCreateAsset(input);
    const existingVersionIds = this.versionsByAssetId.get(asset.assetId) ?? [];
    const versionId = this.generateId('ver');
    const uploadSessionId = this.generateId('upl');
    const versionRecord: VersionRecord = {
      assetId: asset.assetId,
      assetOwner: asset.assetOwner,
      checksum: input.checksum,
      filename: input.filename,
      objectKey: input.objectKey,
      serviceNamespaceId: asset.serviceNamespaceId,
      ...(asset.tenantId ? { tenantId: asset.tenantId } : {}),
      versionId,
      versionNumber: existingVersionIds.length + 1,
      contentType: input.contentType,
      lifecycleState: 'session_created',
      byteLength: input.byteLength
    };
    const sessionRecord: UploadSessionRecord = {
      assetId: asset.assetId,
      checksum: input.checksum,
      contentType: input.contentType,
      expiresAt: input.expiresAt,
      filename: input.filename,
      objectKey: input.objectKey,
      serviceNamespaceId: asset.serviceNamespaceId,
      ...(asset.tenantId ? { tenantId: asset.tenantId } : {}),
      uploadSessionId,
      uploadSessionState: 'session_created',
      versionId
    };
    const persistedResult: IssuedUploadSession = {
      assetId: asset.assetId,
      assetOwner: asset.assetOwner,
      checksum: input.checksum,
      contentType: input.contentType,
      expiresAt: input.expiresAt,
      filename: input.filename,
      objectKey: input.objectKey,
      serviceNamespaceId: asset.serviceNamespaceId,
      ...(asset.tenantId ? { tenantId: asset.tenantId } : {}),
      uploadSessionId,
      versionId,
      versionNumber: versionRecord.versionNumber,
      byteLength: input.byteLength,
      isDuplicate: false
    };

    this.versionsById.set(versionId, versionRecord);
    this.versionsByAssetId.set(asset.assetId, [...existingVersionIds, versionId]);
    this.uploadSessions.set(uploadSessionId, sessionRecord);
    this.idempotencyRecords.set(idempotencyScopeKey, {
      normalizedRequestHash: input.normalizedRequestHash,
      result: persistedResult
    });

    return persistedResult;
  }

  async getUploadSession(uploadSessionId: string): Promise<UploadSessionSummary | null> {
    const session = this.uploadSessions.get(uploadSessionId);

    if (!session) {
      return null;
    }

    return this.buildUploadSessionSummary(session);
  }

  async completeUploadSession(
    input: CompleteUploadSessionInput,
    canonicalize: (request: CanonicalizationRequest) => Promise<SnapshotResult>
  ): Promise<CompletedUploadSession> {
    const session = this.uploadSessions.get(input.uploadSessionId);

    if (!session) {
      throw new UploadSessionNotFoundError(input.uploadSessionId);
    }

    const version = this.versionsById.get(session.versionId);

    if (!version) {
      throw new Error(`Upload session "${input.uploadSessionId}" references a missing version.`);
    }

    const idempotencyScopeKey = buildOperationIdempotencyKey(
      input.callerScopeKey,
      'upload-session:complete',
      input.idempotencyKey
    );
    const existingIdempotencyRecord = this.idempotencyRecords.get(idempotencyScopeKey);

    if (existingIdempotencyRecord) {
      if (existingIdempotencyRecord.normalizedRequestHash !== input.normalizedRequestHash) {
        throw new UploadSessionIdempotencyConflictError(input.idempotencyKey);
      }

      return {
        ...(existingIdempotencyRecord.result as CompletedUploadSession),
        isDuplicate: true
      };
    }

    if (this.now().getTime() > session.expiresAt.getTime()) {
      session.uploadSessionState = 'expired';
      throw new UploadSessionExpiredError(input.uploadSessionId);
    }

    if (session.completionResult) {
      if (session.completionRequestHash !== input.normalizedRequestHash) {
        throw new UploadSessionInvalidStateTransitionError(
          input.uploadSessionId,
          version.lifecycleState
        );
      }

      this.idempotencyRecords.set(idempotencyScopeKey, {
        normalizedRequestHash: input.normalizedRequestHash,
        result: session.completionResult
      });

      return {
        ...session.completionResult,
        isDuplicate: true
      };
    }

    if (session.uploadSessionState === 'terminated') {
      throw new UploadSessionInvalidStateTransitionError(
        input.uploadSessionId,
        session.uploadSessionState
      );
    }

    if (session.uploadSessionState === 'failed_validation') {
      throw new UploadSessionInvalidStateTransitionError(
        input.uploadSessionId,
        session.uploadSessionState
      );
    }

    const persistedCompletionReplay = this.buildCompletionResultFromPersistedEvidence(
      input.uploadSessionId,
      version
    );

    if (
      version.lifecycleState !== 'session_created' &&
      version.lifecycleState !== 'uploaded' &&
      version.lifecycleState !== 'failed_retryable' &&
      !persistedCompletionReplay
    ) {
      throw new UploadSessionInvalidStateTransitionError(
        input.uploadSessionId,
        version.lifecycleState
      );
    }

    if (input.stagedObject.objectKey !== session.objectKey) {
      session.uploadSessionState = 'failed_validation';
      version.lifecycleState = 'failed_validation';
      throw new UploadSessionValidationFailedError(
        input.uploadSessionId,
        'https://docs.cdngine.dev/problems/validation-failed',
        `Upload session "${input.uploadSessionId}" expected staged object "${session.objectKey}" but received "${input.stagedObject.objectKey}".`
      );
    }

    if (input.stagedObject.byteLength !== version.byteLength) {
      session.uploadSessionState = 'failed_validation';
      version.lifecycleState = 'failed_validation';
      throw new UploadSessionValidationFailedError(
        input.uploadSessionId,
        'https://docs.cdngine.dev/problems/validation-failed',
        `Upload session "${input.uploadSessionId}" expected ${version.byteLength} byte(s) but staged validation observed ${input.stagedObject.byteLength} byte(s).`
      );
    }

    const expectedChecksum = version.checksum;
    const descriptorChecksum = input.stagedObject.descriptor.checksum;

    if (
      input.stagedObject.checksum.algorithm !== expectedChecksum.algorithm ||
      input.stagedObject.checksum.value !== expectedChecksum.value ||
      !descriptorChecksum ||
      descriptorChecksum.algorithm !== expectedChecksum.algorithm ||
      descriptorChecksum.value !== expectedChecksum.value
    ) {
      session.uploadSessionState = 'failed_validation';
      version.lifecycleState = 'failed_validation';
      throw new UploadSessionValidationFailedError(
        input.uploadSessionId,
        'https://docs.cdngine.dev/problems/checksum-mismatch',
        `Upload session "${input.uploadSessionId}" did not match the expected checksum evidence.`
      );
    }

    if (persistedCompletionReplay) {
      session.completionRequestHash ??= input.normalizedRequestHash;
      session.completionResult = persistedCompletionReplay;
      this.idempotencyRecords.set(idempotencyScopeKey, {
        normalizedRequestHash: input.normalizedRequestHash,
        result: persistedCompletionReplay
      });

      return {
        ...persistedCompletionReplay,
        isDuplicate: true
      };
    }

    session.uploadSessionState = 'uploaded';
    version.lifecycleState = 'uploaded';
    version.lifecycleState = 'canonicalizing';

    try {
      const canonicalSource = await canonicalize({
        assetId: version.assetId,
        assetOwner: version.assetOwner,
        filename: version.filename,
        serviceNamespaceId: version.serviceNamespaceId,
        ...(version.tenantId ? { tenantId: version.tenantId } : {}),
        uploadSessionId: input.uploadSessionId,
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        stagedObject: input.stagedObject
      });
      const workflowTemplate = input.workflowTemplate ?? 'asset-derivation-v1';
      const workflowDispatch: WorkflowDispatchSummary = {
        dispatchId: this.generateId('wd'),
        state: 'pending',
        workflowKey: buildWorkflowKey(
          version.serviceNamespaceId,
          version.assetId,
          version.versionId,
          workflowTemplate
        )
      };

      version.canonicalSourceEvidence =
        snapshotResultToCanonicalSourceEvidence(canonicalSource);
      version.lifecycleState = 'canonical';
      version.workflowDispatch = workflowDispatch;

      const completionResult: Omit<CompletedUploadSession, 'isDuplicate'> = {
        assetId: version.assetId,
        canonicalSource: canonicalSourceEvidenceToSnapshotResult(version.canonicalSourceEvidence),
        uploadSessionId: input.uploadSessionId,
        versionId: version.versionId,
        versionState: 'canonical',
        workflowDispatch: { ...workflowDispatch }
      };

      session.completionRequestHash = input.normalizedRequestHash;
      session.completionResult = completionResult;
      this.idempotencyRecords.set(idempotencyScopeKey, {
        normalizedRequestHash: input.normalizedRequestHash,
        result: completionResult
      });

      return {
        ...completionResult,
        isDuplicate: false
      };
    } catch (error) {
      version.lifecycleState = 'failed_retryable';
      throw new UploadSessionCanonicalizationFailedError(input.uploadSessionId, error);
    }
  }

  getPersistedVersion(versionId: string) {
    const version = this.versionsById.get(versionId);

    if (!version) {
      return null;
    }

    return {
      ...version,
      checksum: { ...version.checksum },
      ...(version.canonicalSourceEvidence
        ? {
            canonicalSourceEvidence: clonePersistedCanonicalSourceEvidence(
              version.canonicalSourceEvidence
            )
          }
        : {}),
      ...(version.workflowDispatch
        ? {
            workflowDispatch: {
              ...version.workflowDispatch
            }
          }
        : {})
    };
  }

  private resolveOrCreateAsset(input: IssueUploadSessionInput): AssetSummary {
    if (input.assetId) {
      const existingAsset = this.assets.get(input.assetId);

      if (!existingAsset) {
        throw new UploadSessionAssetNotFoundError(input.assetId);
      }

      return existingAsset;
    }

    const assetId = this.generateId('ast');
    const asset: AssetSummary = {
      assetId,
      assetOwner: input.assetOwner,
      serviceNamespaceId: input.serviceNamespaceId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {})
    };

    this.assets.set(assetId, asset);
    return asset;
  }

  private buildCompletionResultFromPersistedEvidence(
    uploadSessionId: string,
    version: VersionRecord
  ): Omit<CompletedUploadSession, 'isDuplicate'> | null {
    if (
      (version.lifecycleState !== 'canonical' && version.lifecycleState !== 'processing') ||
      !version.canonicalSourceEvidence ||
      !version.workflowDispatch
    ) {
      return null;
    }

    return {
      assetId: version.assetId,
      canonicalSource: canonicalSourceEvidenceToSnapshotResult(version.canonicalSourceEvidence),
      uploadSessionId,
      versionId: version.versionId,
      versionState: version.lifecycleState,
      workflowDispatch: {
        ...version.workflowDispatch
      }
    };
  }

  private buildUploadSessionSummary(session: UploadSessionRecord): UploadSessionSummary {
    const version = this.versionsById.get(session.versionId);

    if (!version) {
      throw new Error(`Upload session "${session.uploadSessionId}" references a missing version.`);
    }

    return {
      assetId: session.assetId,
      assetOwner: version.assetOwner,
      checksum: { ...session.checksum },
      contentType: session.contentType,
      expiresAt: new Date(session.expiresAt),
      filename: session.filename,
      objectKey: session.objectKey,
      serviceNamespaceId: session.serviceNamespaceId,
      ...(session.tenantId ? { tenantId: session.tenantId } : {}),
      uploadSessionId: session.uploadSessionId,
      uploadSessionState: session.uploadSessionState,
      versionId: session.versionId,
      versionNumber: version.versionNumber,
      versionState: version.lifecycleState,
      byteLength: version.byteLength
    };
  }
}
