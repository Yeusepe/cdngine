/**
 * Purpose: Defines the upload-session issuance service contract and a deterministic in-memory implementation for route and idempotency tests.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://tus.io/protocols/resumable-upload
 * Tests:
 * - apps/api/test/upload-session-routes.test.mjs
 */

import type { ObjectChecksum } from '@cdngine/storage';

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

export interface UploadSessionIssuanceStore {
  issueUploadSession(input: IssueUploadSessionInput): Promise<IssuedUploadSession>;
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

interface AssetSummary {
  assetId: string;
  assetOwner: string;
  serviceNamespaceId: string;
  tenantId?: string;
}

interface PersistedIssuanceRecord extends Omit<IssuedUploadSession, 'isDuplicate'> {}

export interface InMemoryUploadSessionIssuanceStoreOptions {
  generateId?: (prefix: 'ast' | 'ver' | 'upl') => string;
}

export class InMemoryUploadSessionIssuanceStore implements UploadSessionIssuanceStore {
  private readonly assets = new Map<string, AssetSummary>();
  private readonly versionsByAssetId = new Map<string, PersistedIssuanceRecord[]>();
  private readonly idempotencyRecords = new Map<
    string,
    {
      normalizedRequestHash: string;
      result: PersistedIssuanceRecord;
    }
  >();
  private readonly generateId: (prefix: 'ast' | 'ver' | 'upl') => string;

  constructor(options: InMemoryUploadSessionIssuanceStoreOptions = {}) {
    this.generateId =
      options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 26)}`);
  }

  async issueUploadSession(input: IssueUploadSessionInput): Promise<IssuedUploadSession> {
    const idempotencyScopeKey = `${input.callerScopeKey}:${input.idempotencyKey}`;
    const existingIdempotencyRecord = this.idempotencyRecords.get(idempotencyScopeKey);

    if (existingIdempotencyRecord) {
      if (existingIdempotencyRecord.normalizedRequestHash !== input.normalizedRequestHash) {
        throw new UploadSessionIdempotencyConflictError(input.idempotencyKey);
      }

      return {
        ...existingIdempotencyRecord.result,
        isDuplicate: true
      };
    }

    const asset = this.resolveOrCreateAsset(input);
    const existingVersions = this.versionsByAssetId.get(asset.assetId) ?? [];
    const persistedResult: PersistedIssuanceRecord = {
      assetId: asset.assetId,
      assetOwner: asset.assetOwner,
      checksum: input.checksum,
      contentType: input.contentType,
      expiresAt: input.expiresAt,
      filename: input.filename,
      objectKey: input.objectKey,
      serviceNamespaceId: asset.serviceNamespaceId,
      ...(asset.tenantId ? { tenantId: asset.tenantId } : {}),
      uploadSessionId: this.generateId('upl'),
      versionId: this.generateId('ver'),
      versionNumber: existingVersions.length + 1,
      byteLength: input.byteLength
    };

    this.versionsByAssetId.set(asset.assetId, [...existingVersions, persistedResult]);
    this.idempotencyRecords.set(idempotencyScopeKey, {
      normalizedRequestHash: input.normalizedRequestHash,
      result: persistedResult
    });

    return {
      ...persistedResult,
      isDuplicate: false
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
}
