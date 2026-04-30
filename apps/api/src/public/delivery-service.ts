/**
 * Purpose: Defines the public delivery and original-source authorization service contracts plus a deterministic in-memory implementation for version, manifest, and delivery route tests.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/original-source-delivery.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/security-model.md
 * External references:
 * - https://www.rfc-editor.org/rfc/rfc9111
 * - https://oras.land/docs/
 * Tests:
 * - apps/api/test/delivery-routes.test.mjs
 */

import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  buildMaterializedSourcePath,
  clonePersistedCanonicalSourceEvidence,
  materializeCanonicalSourceToPath,
  resolveMaterializedSourceFilename,
  type ExportsObjectStore,
  type PersistedCanonicalSourceEvidence,
  type SourceDeliveryMode,
  type SourceRepository
} from '@cdngine/storage';

export type DeliveryAuthorizationMode = 'public' | 'signed-url';
export type DeliveryResolvedOrigin =
  | 'cdn-derived'
  | 'origin-derived'
  | 'source-export'
  | 'source-proxy'
  | 'lazy-read-cache';
export type PublicLifecycleState =
  | 'canonical'
  | 'processing'
  | 'published'
  | 'quarantined'
  | 'purged'
  | 'failed_retryable';

export interface PublicAssetVersionRecord {
  assetId: string;
  assetOwner: string;
  canonicalSourceEvidence?: PersistedCanonicalSourceEvidence;
  defaultManifestType?: string;
  lifecycleState: PublicLifecycleState;
  serviceNamespaceId: string;
  source: {
    byteLength: bigint;
    contentType: string;
    filename: string;
  };
  tenantId?: string;
  versionId: string;
  versionNumber: number;
  workflowState: string;
}

export interface PublicDerivativeRecord {
  assetId: string;
  byteLength: bigint;
  contentType: string;
  deliveryScopeId: string;
  deterministicKey: string;
  derivativeId: string;
  recipeId: string;
  storageKey: string;
  variant: string;
  versionId: string;
}

export interface PublicManifestRecord {
  assetId: string;
  deliveryScopeId: string;
  manifestPayload: Record<string, unknown>;
  manifestType: string;
  objectKey: string;
  versionId: string;
}

export interface SourceAuthorizationRecord {
  assetId: string;
  authorizationMode: DeliveryAuthorizationMode;
  expiresAt: Date;
  oneTime?: boolean;
  remainingUses?: number;
  resolvedOrigin: Extract<DeliveryResolvedOrigin, 'source-export' | 'source-proxy' | 'lazy-read-cache'>;
  tenantId?: string;
  url: string;
  versionId: string;
}

export interface DeliveryAuthorizationRecord {
  assetId: string;
  authorizationMode: DeliveryAuthorizationMode;
  deliveryScopeId: string;
  expiresAt: Date;
  oneTime?: boolean;
  remainingUses?: number;
  resolvedOrigin: Extract<DeliveryResolvedOrigin, 'cdn-derived' | 'origin-derived'>;
  url: string;
  versionId: string;
}

export interface PublicAuthorizationRequest {
  idempotencyKey: string;
  now: Date;
  oneTime?: boolean;
}

export interface PublicDownloadLinkRecord {
  expiresAt: Date;
  token: string;
  url: string;
}

export interface PublicVersionReadStore {
  authorizeDelivery(
    assetId: string,
    versionId: string,
    deliveryScopeId: string,
    variant: string,
    request: PublicAuthorizationRequest
  ): Promise<DeliveryAuthorizationRecord>;
  authorizeSource(
    assetId: string,
    versionId: string,
    preferredDisposition: 'attachment' | 'inline' | undefined,
    request: PublicAuthorizationRequest
  ): Promise<SourceAuthorizationRecord>;
  consumeDownloadLink(token: string, now: Date): Promise<PublicDownloadLinkRecord>;
  getManifest(assetId: string, versionId: string, manifestType: string): Promise<PublicManifestRecord | null>;
  getVersion(assetId: string, versionId: string): Promise<PublicAssetVersionRecord | null>;
  listDerivatives(assetId: string, versionId: string): Promise<PublicDerivativeRecord[]>;
}

export class PublicAssetVersionNotFoundError extends Error {
  constructor(readonly assetId: string, readonly versionId: string) {
    super(`Version "${versionId}" for asset "${assetId}" does not exist.`);
    this.name = 'PublicAssetVersionNotFoundError';
  }
}

export class PublicVersionNotReadyError extends Error {
  constructor(readonly assetId: string, readonly versionId: string, readonly lifecycleState: PublicLifecycleState) {
    super(`Version "${versionId}" for asset "${assetId}" is not ready for this operation from state "${lifecycleState}".`);
    this.name = 'PublicVersionNotReadyError';
  }
}

export class PublicDownloadLinkNotFoundError extends Error {
  constructor(readonly token: string) {
    super(`Download link "${token}" is invalid, expired, or has already been used.`);
    this.name = 'PublicDownloadLinkNotFoundError';
  }
}

export interface SeedPublicAssetVersionRecord extends PublicAssetVersionRecord {
  deliveries?: PublicDerivativeRecord[];
  manifests?: PublicManifestRecord[];
  sourceAuthorization?: Omit<SourceAuthorizationRecord, 'assetId' | 'versionId'>;
}

export interface InMemoryPublicVersionReadStoreOptions {
  linkTokenFactory?: () => string;
  sourceReads?: {
    exportsObjectStore: ExportsObjectStore;
    materializationRootPath: string;
    sourceDeliveryMode: SourceDeliveryMode;
    sourceRepository: SourceRepository;
  };
  versions?: SeedPublicAssetVersionRecord[];
}

interface ConsumableDownloadLinkRecord {
  expiresAt: Date;
  token: string;
  url: string;
}

function cloneVersion(record: PublicAssetVersionRecord): PublicAssetVersionRecord {
  return {
    assetId: record.assetId,
    assetOwner: record.assetOwner,
    ...(record.canonicalSourceEvidence
      ? {
          canonicalSourceEvidence: clonePersistedCanonicalSourceEvidence(
            record.canonicalSourceEvidence
          )
        }
      : {}),
    ...(record.defaultManifestType ? { defaultManifestType: record.defaultManifestType } : {}),
    lifecycleState: record.lifecycleState,
    serviceNamespaceId: record.serviceNamespaceId,
    source: {
      byteLength: record.source.byteLength,
      contentType: record.source.contentType,
      filename: record.source.filename
    },
    ...(record.tenantId ? { tenantId: record.tenantId } : {}),
    versionId: record.versionId,
    versionNumber: record.versionNumber,
    workflowState: record.workflowState
  };
}

function cloneDerivative(record: PublicDerivativeRecord): PublicDerivativeRecord {
  return {
    assetId: record.assetId,
    byteLength: record.byteLength,
    contentType: record.contentType,
    deliveryScopeId: record.deliveryScopeId,
    deterministicKey: record.deterministicKey,
    derivativeId: record.derivativeId,
    recipeId: record.recipeId,
    storageKey: record.storageKey,
    variant: record.variant,
    versionId: record.versionId
  };
}

function cloneManifest(record: PublicManifestRecord): PublicManifestRecord {
  return {
    assetId: record.assetId,
    deliveryScopeId: record.deliveryScopeId,
    manifestPayload: { ...record.manifestPayload },
    manifestType: record.manifestType,
    objectKey: record.objectKey,
    versionId: record.versionId
  };
}

function cloneSourceAuthorization(
  record: SourceAuthorizationRecord
): SourceAuthorizationRecord {
  return {
    assetId: record.assetId,
    authorizationMode: record.authorizationMode,
    expiresAt: new Date(record.expiresAt),
    ...(record.oneTime ? { oneTime: true } : {}),
    ...(typeof record.remainingUses === 'number' ? { remainingUses: record.remainingUses } : {}),
    resolvedOrigin: record.resolvedOrigin,
    ...(record.tenantId ? { tenantId: record.tenantId } : {}),
    url: record.url,
    versionId: record.versionId
  };
}

function cloneDeliveryAuthorization(
  record: DeliveryAuthorizationRecord
): DeliveryAuthorizationRecord {
  return {
    assetId: record.assetId,
    authorizationMode: record.authorizationMode,
    deliveryScopeId: record.deliveryScopeId,
    expiresAt: new Date(record.expiresAt),
    ...(record.oneTime ? { oneTime: true } : {}),
    ...(typeof record.remainingUses === 'number' ? { remainingUses: record.remainingUses } : {}),
    resolvedOrigin: record.resolvedOrigin,
    url: record.url,
    versionId: record.versionId
  };
}

export class InMemoryPublicVersionReadStore implements PublicVersionReadStore {
  private readonly deliveryAuthorizations = new Map<string, DeliveryAuthorizationRecord>();
  private readonly downloadLinks = new Map<string, ConsumableDownloadLinkRecord>();
  private readonly derivatives = new Map<string, PublicDerivativeRecord[]>();
  private readonly linkTokenFactory: () => string;
  private readonly manifests = new Map<string, PublicManifestRecord>();
  private readonly sourceAuthorizationsByRequest = new Map<string, SourceAuthorizationRecord>();
  private readonly sourceAuthorizations = new Map<string, Omit<SourceAuthorizationRecord, 'assetId' | 'versionId'>>();
  private readonly versions = new Map<string, PublicAssetVersionRecord>();

  constructor(private readonly options: InMemoryPublicVersionReadStoreOptions = {}) {
    this.linkTokenFactory = options.linkTokenFactory ?? (() => crypto.randomUUID());

    for (const version of options.versions ?? []) {
      const key = this.buildKey(version.assetId, version.versionId);
      this.versions.set(key, cloneVersion(version));
      this.derivatives.set(key, (version.deliveries ?? []).map((item) => cloneDerivative(item)));

      for (const manifest of version.manifests ?? []) {
        this.manifests.set(`${key}:${manifest.manifestType}`, cloneManifest(manifest));
      }

      if (version.sourceAuthorization) {
        this.sourceAuthorizations.set(key, {
          authorizationMode: version.sourceAuthorization.authorizationMode,
          expiresAt: new Date(version.sourceAuthorization.expiresAt),
          resolvedOrigin: version.sourceAuthorization.resolvedOrigin,
          ...(version.sourceAuthorization.tenantId ? { tenantId: version.sourceAuthorization.tenantId } : {}),
          url: version.sourceAuthorization.url
        });
      }
    }
  }

  async authorizeDelivery(
    assetId: string,
    versionId: string,
    deliveryScopeId: string,
    variant: string,
    request: PublicAuthorizationRequest
  ): Promise<DeliveryAuthorizationRecord> {
    const version = this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    const derivative = (this.derivatives.get(this.buildKey(assetId, versionId)) ?? []).find(
      (candidate) =>
        candidate.deliveryScopeId === deliveryScopeId && candidate.variant === variant
    );

    if (!derivative) {
      throw new PublicAssetVersionNotFoundError(assetId, versionId);
    }

    const authorization: DeliveryAuthorizationRecord = {
      assetId,
      authorizationMode: 'signed-url',
      deliveryScopeId,
      expiresAt: new Date(request.now.getTime() + 15 * 60_000),
      resolvedOrigin: 'cdn-derived',
      url: `https://cdn.cdngine.local/${deliveryScopeId}/${derivative.variant}`,
      versionId
    };

    if (!request.oneTime) {
      return authorization;
    }

    const requestKey = this.buildDeliveryAuthorizationKey(
      assetId,
      versionId,
      deliveryScopeId,
      variant,
      request.idempotencyKey
    );
    const existing = this.deliveryAuthorizations.get(requestKey);

    if (existing) {
      return cloneDeliveryAuthorization(existing);
    }

    const token = this.linkTokenFactory();
    const oneTimeAuthorization: DeliveryAuthorizationRecord = {
      ...authorization,
      oneTime: true,
      remainingUses: 1,
      url: `https://api.cdngine.local/download-links/${token}`
    };

    this.downloadLinks.set(token, {
      expiresAt: new Date(oneTimeAuthorization.expiresAt),
      token,
      url: authorization.url
    });
    this.deliveryAuthorizations.set(requestKey, oneTimeAuthorization);

    return cloneDeliveryAuthorization(oneTimeAuthorization);
  }

  async authorizeSource(
    assetId: string,
    versionId: string,
    preferredDisposition: 'attachment' | 'inline' | undefined,
    request: PublicAuthorizationRequest
  ): Promise<SourceAuthorizationRecord> {
    const version = this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState === 'quarantined' || version.lifecycleState === 'purged') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    const materializedAuthorization = await this.authorizeMaterializedSource(version, request);

    const authorization = this.sourceAuthorizations.get(this.buildKey(assetId, versionId));
    const baseAuthorization: SourceAuthorizationRecord =
      materializedAuthorization ??
      (authorization
        ? {
            assetId,
            authorizationMode: authorization.authorizationMode,
            expiresAt: new Date(request.now.getTime() + 15 * 60_000),
            resolvedOrigin: authorization.resolvedOrigin,
            ...(authorization.tenantId ? { tenantId: authorization.tenantId } : {}),
            url: authorization.url,
            versionId
          }
        : {
            assetId,
            authorizationMode: 'signed-url',
            expiresAt: new Date(request.now.getTime() + 15 * 60_000),
            resolvedOrigin: 'source-proxy',
            url: `https://api.cdngine.local/v1/assets/${assetId}/versions/${versionId}/source/proxy`,
            versionId
          });

    if (!request.oneTime) {
      return baseAuthorization;
    }

    const requestKey = this.buildSourceAuthorizationKey(
      assetId,
      versionId,
      preferredDisposition,
      request.idempotencyKey
    );
    const existing = this.sourceAuthorizationsByRequest.get(requestKey);

    if (existing) {
      return cloneSourceAuthorization(existing);
    }

    const token = this.linkTokenFactory();
    const oneTimeAuthorization: SourceAuthorizationRecord = {
      ...baseAuthorization,
      oneTime: true,
      remainingUses: 1,
      url: `https://api.cdngine.local/download-links/${token}`
    };

    this.downloadLinks.set(token, {
      expiresAt: new Date(oneTimeAuthorization.expiresAt),
      token,
      url: baseAuthorization.url
    });
    this.sourceAuthorizationsByRequest.set(requestKey, oneTimeAuthorization);

    return cloneSourceAuthorization(oneTimeAuthorization);
  }

  async consumeDownloadLink(token: string, now: Date): Promise<PublicDownloadLinkRecord> {
    const link = this.downloadLinks.get(token);

    if (!link || link.expiresAt.getTime() <= now.getTime()) {
      throw new PublicDownloadLinkNotFoundError(token);
    }

    this.downloadLinks.delete(token);

    return {
      expiresAt: new Date(link.expiresAt),
      token: link.token,
      url: link.url
    };
  }

  async getManifest(
    assetId: string,
    versionId: string,
    manifestType: string
  ): Promise<PublicManifestRecord | null> {
    this.assertPublished(assetId, versionId);
    const manifest = this.manifests.get(`${this.buildKey(assetId, versionId)}:${manifestType}`);
    return manifest ? cloneManifest(manifest) : null;
  }

  async getVersion(assetId: string, versionId: string): Promise<PublicAssetVersionRecord | null> {
    const version = this.versions.get(this.buildKey(assetId, versionId));
    return version ? cloneVersion(version) : null;
  }

  async listDerivatives(assetId: string, versionId: string): Promise<PublicDerivativeRecord[]> {
    this.assertPublished(assetId, versionId);
    return (this.derivatives.get(this.buildKey(assetId, versionId)) ?? []).map((record) =>
      cloneDerivative(record)
    );
  }

  private assertPublished(assetId: string, versionId: string) {
    const version = this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }
  }

  private buildKey(assetId: string, versionId: string) {
    return `${assetId}:${versionId}`;
  }

  private async authorizeMaterializedSource(
    version: PublicAssetVersionRecord,
    request: PublicAuthorizationRequest
  ): Promise<SourceAuthorizationRecord | undefined> {
    if (
      !this.options.sourceReads ||
      this.options.sourceReads.sourceDeliveryMode !== 'materialized-export' ||
      !version.canonicalSourceEvidence
    ) {
      return undefined;
    }

    const fileName = resolveMaterializedSourceFilename({
      sourceFilename: version.source.filename,
      canonicalLogicalPath: version.canonicalSourceEvidence.canonicalLogicalPath
    });
    const destinationPath = buildMaterializedSourcePath({
      rootPath: this.options.sourceReads.materializationRootPath,
      pathSegments: [version.assetId, version.versionId],
      sourceFilename: version.source.filename,
      canonicalLogicalPath: version.canonicalSourceEvidence.canonicalLogicalPath
    });
    await mkdir(dirname(destinationPath), { recursive: true });
    const restored = await materializeCanonicalSourceToPath(this.options.sourceReads.sourceRepository, {
      canonicalSource: version.canonicalSourceEvidence,
      destinationPath
    });
    const restoredStats = await stat(restored.restoredPath);
    const exportObjectKey = [
      'source-downloads',
      version.serviceNamespaceId,
      version.assetId,
      version.versionId,
      fileName
    ].join('/');
    await this.options.sourceReads.exportsObjectStore.publishExport({
      body: createReadStream(restored.restoredPath),
      byteLength: BigInt(restoredStats.size),
      ...(version.canonicalSourceEvidence.canonicalDigestSet[0]
        ? { checksum: version.canonicalSourceEvidence.canonicalDigestSet[0] }
        : {}),
      contentType: version.source.contentType,
      objectKey: exportObjectKey
    });
    const signed = await this.options.sourceReads.exportsObjectStore.issueSignedReadUrl(
      exportObjectKey,
      new Date(request.now.getTime() + 15 * 60_000)
    );

    return {
      assetId: version.assetId,
      authorizationMode: 'signed-url',
      expiresAt: signed.expiresAt,
      resolvedOrigin: 'source-export',
      ...(version.tenantId ? { tenantId: version.tenantId } : {}),
      url: signed.url,
      versionId: version.versionId
    };
  }

  private buildDeliveryAuthorizationKey(
    assetId: string,
    versionId: string,
    deliveryScopeId: string,
    variant: string,
    idempotencyKey: string
  ) {
    return `delivery:${this.buildKey(assetId, versionId)}:${deliveryScopeId}:${variant}:${idempotencyKey}`;
  }

  private buildSourceAuthorizationKey(
    assetId: string,
    versionId: string,
    preferredDisposition: 'attachment' | 'inline' | undefined,
    idempotencyKey: string
  ) {
    return `source:${this.buildKey(assetId, versionId)}:${preferredDisposition ?? 'default'}:${idempotencyKey}`;
  }

  private getRequiredVersion(assetId: string, versionId: string): PublicAssetVersionRecord {
    const version = this.versions.get(this.buildKey(assetId, versionId));

    if (!version) {
      throw new PublicAssetVersionNotFoundError(assetId, versionId);
    }

    return version;
  }
}
