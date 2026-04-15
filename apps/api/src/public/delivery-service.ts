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
  resolvedOrigin: Extract<DeliveryResolvedOrigin, 'cdn-derived' | 'origin-derived'>;
  url: string;
  versionId: string;
}

export interface PublicVersionReadStore {
  authorizeDelivery(
    assetId: string,
    versionId: string,
    deliveryScopeId: string,
    variant: string,
    now: Date
  ): Promise<DeliveryAuthorizationRecord>;
  authorizeSource(
    assetId: string,
    versionId: string,
    preferredDisposition: 'attachment' | 'inline' | undefined,
    now: Date
  ): Promise<SourceAuthorizationRecord>;
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

export interface SeedPublicAssetVersionRecord extends PublicAssetVersionRecord {
  deliveries?: PublicDerivativeRecord[];
  manifests?: PublicManifestRecord[];
  sourceAuthorization?: Omit<SourceAuthorizationRecord, 'assetId' | 'versionId'>;
}

export interface InMemoryPublicVersionReadStoreOptions {
  versions?: SeedPublicAssetVersionRecord[];
}

function cloneVersion(record: PublicAssetVersionRecord): PublicAssetVersionRecord {
  return {
    assetId: record.assetId,
    assetOwner: record.assetOwner,
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

export class InMemoryPublicVersionReadStore implements PublicVersionReadStore {
  private readonly derivatives = new Map<string, PublicDerivativeRecord[]>();
  private readonly manifests = new Map<string, PublicManifestRecord>();
  private readonly sourceAuthorizations = new Map<string, Omit<SourceAuthorizationRecord, 'assetId' | 'versionId'>>();
  private readonly versions = new Map<string, PublicAssetVersionRecord>();

  constructor(options: InMemoryPublicVersionReadStoreOptions = {}) {
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
    now: Date
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

    return {
      assetId,
      authorizationMode: 'signed-url',
      deliveryScopeId,
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      resolvedOrigin: 'cdn-derived',
      url: `https://cdn.cdngine.local/${deliveryScopeId}/${derivative.variant}`,
      versionId
    };
  }

  async authorizeSource(
    assetId: string,
    versionId: string,
    _preferredDisposition: 'attachment' | 'inline' | undefined,
    now: Date
  ): Promise<SourceAuthorizationRecord> {
    const version = this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState === 'quarantined' || version.lifecycleState === 'purged') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    const authorization = this.sourceAuthorizations.get(this.buildKey(assetId, versionId));

    if (authorization) {
      return {
        assetId,
        authorizationMode: authorization.authorizationMode,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
        resolvedOrigin: authorization.resolvedOrigin,
        ...(authorization.tenantId ? { tenantId: authorization.tenantId } : {}),
        url: authorization.url,
        versionId
      };
    }

    return {
      assetId,
      authorizationMode: 'signed-url',
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      resolvedOrigin: 'source-proxy',
      url: `https://api.cdngine.local/v1/assets/${assetId}/versions/${versionId}/source/proxy`,
      versionId
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

  private getRequiredVersion(assetId: string, versionId: string): PublicAssetVersionRecord {
    const version = this.versions.get(this.buildKey(assetId, versionId));

    if (!version) {
      throw new PublicAssetVersionNotFoundError(assetId, versionId);
    }

    return version;
  }
}
