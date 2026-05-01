/**
 * Purpose: Reads public version, manifest, derivative, and authorization state from the durable registry while auditing issued source and delivery grants.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/select-fields
 * - https://www.rfc-editor.org/rfc/rfc9111
 * Tests:
 * - packages/registry/test/prisma-upload-session-store.test.mjs
 */

import { createHash, randomUUID } from 'node:crypto';

import { AssetVersionState, ResolvedOrigin } from './generated/prisma/enums.js';
import type { Prisma } from './generated/prisma/client.js';
import { createRegistryPrismaClient, type RegistryPrismaClient } from './prisma-client.js';

export type RegistryDeliveryAuthorizationMode = 'public' | 'signed-url';
export type RegistryDeliveryResolvedOrigin =
  | 'cdn-derived'
  | 'origin-derived'
  | 'source-export'
  | 'source-proxy'
  | 'lazy-read-cache';
export type RegistryPublicLifecycleState =
  | 'canonical'
  | 'processing'
  | 'published'
  | 'quarantined'
  | 'purged'
  | 'failed_retryable';

export interface RegistryPublicAssetVersionRecord {
  assetId: string;
  assetOwner: string;
  canonicalSourceEvidence?: {
    canonicalDigestSet: Array<{ algorithm: string; value: string }>;
    canonicalLogicalByteLength?: bigint;
    canonicalLogicalPath: string;
    canonicalSnapshotId: string;
    canonicalSourceId: string;
    canonicalStoredByteLength?: bigint;
    dedupeMetrics?: Record<string, unknown>;
    repositoryEngine: string;
    sourceReconstructionHandles?: unknown[];
    sourceSubstrateHints?: Record<string, unknown>;
  };
  defaultManifestType?: string;
  lifecycleState: RegistryPublicLifecycleState;
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

export interface RegistryPublicDerivativeRecord {
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

export interface RegistryPublicManifestRecord {
  assetId: string;
  deliveryScopeId: string;
  manifestPayload: Record<string, unknown>;
  manifestType: string;
  objectKey: string;
  versionId: string;
}

export interface RegistrySourceAuthorizationRecord {
  assetId: string;
  authorizationMode: RegistryDeliveryAuthorizationMode;
  expiresAt: Date;
  oneTime?: boolean;
  remainingUses?: number;
  resolvedOrigin: Extract<
    RegistryDeliveryResolvedOrigin,
    'source-export' | 'source-proxy' | 'lazy-read-cache'
  >;
  tenantId?: string;
  url: string;
  versionId: string;
}

export interface RegistryDeliveryAuthorizationRecord {
  assetId: string;
  authorizationMode: RegistryDeliveryAuthorizationMode;
  deliveryScopeId: string;
  expiresAt: Date;
  oneTime?: boolean;
  remainingUses?: number;
  resolvedOrigin: Extract<RegistryDeliveryResolvedOrigin, 'cdn-derived' | 'origin-derived'>;
  url: string;
  versionId: string;
}

export interface RegistryPublicAuthorizationRequest {
  callerScopeKey: string;
  idempotencyKey: string;
  now: Date;
  oneTime?: boolean;
}

export interface RegistryPublicDownloadLinkRecord {
  expiresAt: Date;
  token: string;
  url: string;
}

function asChecksumArray(value: Prisma.JsonValue | null | undefined) {
  return (Array.isArray(value) ? value : []) as Array<{ algorithm: string; value: string }>;
}

function asRecord(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value : undefined;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
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
    return value.map((item) => toInputJsonValue(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toInputJsonValue(entry)])
    ) as Prisma.InputJsonObject;
  }

  return String(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    return JSON.stringify(Number.isFinite(value) ? value : String(value));
  }

  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (typeof value === 'object' && value !== undefined) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(String(value));
}

function hashAuthorizationRequest(value: Record<string, unknown>) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function buildDeliveryAuthorizationOperationKey(input: {
  assetId: string;
  deliveryScopeId: string;
  versionId: string;
}) {
  return `delivery:authorize:${input.assetId}:${input.versionId}:${input.deliveryScopeId}`;
}

function buildSourceAuthorizationOperationKey(input: { assetId: string; versionId: string }) {
  return `source:authorize:${input.assetId}:${input.versionId}`;
}

function buildAuthorizationResponsePayload(
  record: RegistryDeliveryAuthorizationRecord | RegistrySourceAuthorizationRecord
) {
  return {
    ...record,
    expiresAt: record.expiresAt.toISOString()
  };
}

function readReplayRecord(
  value: Prisma.JsonValue | null | undefined
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readReplayString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Authorization idempotency replay is missing "${key}".`);
  }
  return value;
}

function readReplayBoolean(record: Record<string, unknown>, key: string) {
  return record[key] === true ? true : undefined;
}

function readReplayNumber(record: Record<string, unknown>, key: string) {
  return typeof record[key] === 'number' ? record[key] : undefined;
}

function buildDeliveryAuthorizationReplay(
  payload: Prisma.JsonValue | null | undefined
): RegistryDeliveryAuthorizationRecord {
  const record = readReplayRecord(payload);
  if (!record) {
    throw new Error('Delivery authorization idempotency record is missing a replay payload.');
  }
  const remainingUses = readReplayNumber(record, 'remainingUses');

  return {
    assetId: readReplayString(record, 'assetId'),
    authorizationMode: readReplayString(record, 'authorizationMode') as RegistryDeliveryAuthorizationMode,
    deliveryScopeId: readReplayString(record, 'deliveryScopeId'),
    expiresAt: new Date(readReplayString(record, 'expiresAt')),
    ...(readReplayBoolean(record, 'oneTime') ? { oneTime: true } : {}),
    ...(remainingUses !== undefined ? { remainingUses } : {}),
    resolvedOrigin: readReplayString(record, 'resolvedOrigin') as Extract<
      RegistryDeliveryResolvedOrigin,
      'cdn-derived' | 'origin-derived'
    >,
    url: readReplayString(record, 'url'),
    versionId: readReplayString(record, 'versionId')
  };
}

function buildSourceAuthorizationReplay(
  payload: Prisma.JsonValue | null | undefined
): RegistrySourceAuthorizationRecord {
  const record = readReplayRecord(payload);
  if (!record) {
    throw new Error('Source authorization idempotency record is missing a replay payload.');
  }
  const remainingUses = readReplayNumber(record, 'remainingUses');

  return {
    assetId: readReplayString(record, 'assetId'),
    authorizationMode: readReplayString(record, 'authorizationMode') as RegistryDeliveryAuthorizationMode,
    expiresAt: new Date(readReplayString(record, 'expiresAt')),
    ...(readReplayBoolean(record, 'oneTime') ? { oneTime: true } : {}),
    ...(remainingUses !== undefined ? { remainingUses } : {}),
    resolvedOrigin: readReplayString(record, 'resolvedOrigin') as Extract<
      RegistryDeliveryResolvedOrigin,
      'source-export' | 'source-proxy' | 'lazy-read-cache'
    >,
    ...(typeof record.tenantId === 'string' ? { tenantId: record.tenantId } : {}),
    url: readReplayString(record, 'url'),
    versionId: readReplayString(record, 'versionId')
  };
}

function mapLifecycleState(state: string): RegistryPublicLifecycleState {
  switch (state) {
    case AssetVersionState.canonical:
      return 'canonical';
    case AssetVersionState.published:
      return 'published';
    case AssetVersionState.quarantined:
      return 'quarantined';
    case AssetVersionState.purged:
      return 'purged';
    case AssetVersionState.failed_retryable:
    case AssetVersionState.failed_validation:
      return 'failed_retryable';
    default:
      return 'processing';
  }
}

function extractUrlFromMetadata(
  value: Prisma.JsonValue | null | undefined
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const url = (value as Record<string, unknown>).url;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

export class RegistryPublicAssetVersionNotFoundError extends Error {
  constructor(readonly assetId: string, readonly versionId: string) {
    super(`Version "${versionId}" for asset "${assetId}" does not exist.`);
    this.name = 'RegistryPublicAssetVersionNotFoundError';
  }
}

export class RegistryPublicVersionNotReadyError extends Error {
  constructor(readonly assetId: string, readonly versionId: string, readonly lifecycleState: string) {
    super(`Version "${versionId}" for asset "${assetId}" is not ready for this operation from state "${lifecycleState}".`);
    this.name = 'RegistryPublicVersionNotReadyError';
  }
}

export class RegistryPublicDownloadLinkNotFoundError extends Error {
  constructor(readonly token: string) {
    super(`Download link "${token}" is invalid, expired, or has already been used.`);
    this.name = 'RegistryPublicDownloadLinkNotFoundError';
  }
}

export class RegistryPublicReadIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was reused for a different public-read authorization request.`);
    this.name = 'RegistryPublicReadIdempotencyConflictError';
  }
}

export class PrismaPublicVersionReadStore {
  constructor(
    private readonly options: {
      prisma?: RegistryPrismaClient;
    } = {}
  ) {}

  private get prisma() {
    return this.options.prisma ?? createRegistryPrismaClient();
  }

  async authorizeDelivery(
    assetId: string,
    versionId: string,
    deliveryScopeId: string,
    variant: string,
    request: RegistryPublicAuthorizationRequest
  ): Promise<RegistryDeliveryAuthorizationRecord> {
    const operationKey = buildDeliveryAuthorizationOperationKey({
      assetId,
      deliveryScopeId,
      versionId
    });
    const normalizedOperationKey = `${operationKey}:${variant}:${request.oneTime === true ? 'one-time' : 'reusable'}`;
    const normalizedRequestHash = hashAuthorizationRequest({
      assetId,
      authorizationFamily: 'delivery',
      deliveryScopeId,
      oneTime: request.oneTime === true,
      variant,
      versionId
    });
    const replay = await this.loadDeliveryAuthorizationReplay({
      callerScopeKey: request.callerScopeKey,
      idempotencyKey: request.idempotencyKey,
      normalizedRequestHash,
      operationKey
    });

    if (replay) {
      return replay;
    }

    const derivative = await this.prisma.derivative.findFirst({
      where: {
        assetVersionId: versionId,
        assetVersion: { assetId, lifecycleState: AssetVersionState.published },
        deliveryScopeId,
        variantKey: variant
      },
      include: {
        assetVersion: {
          include: {
            asset: {
              include: {
                serviceNamespace: { select: { serviceNamespaceId: true } }
              }
            }
          }
        },
        deliveryScope: true
      }
    });

    if (!derivative) {
      await this.assertVersionPublished(assetId, versionId);
      throw new RegistryPublicAssetVersionNotFoundError(assetId, versionId);
    }

    const expiresAt = new Date(request.now.getTime() + 15 * 60_000);
    const directUrl = this.buildDeliveryUrl(derivative.deliveryScope, derivative.storageKey);
    const token = request.oneTime ? randomUUID() : undefined;
    const authorization: RegistryDeliveryAuthorizationRecord = {
      assetId,
      authorizationMode: 'signed-url',
      deliveryScopeId,
      expiresAt,
      ...(request.oneTime ? { oneTime: true, remainingUses: 1 } : {}),
      resolvedOrigin: 'cdn-derived',
      url: token ? `/download-links/${token}` : directUrl,
      versionId
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.deliveryAuthorizationAudit.create({
          data: {
            actorScopeKey: request.callerScopeKey,
            assetVersionId: versionId,
            authorizationFamily: 'delivery',
            authorizationMode: 'signed_url',
            deliveryScopeId,
            expiresAt,
            ...(token ? { grantId: token } : {}),
            requestMetadata: toInputJsonValue({
              idempotencyKey: request.idempotencyKey,
              oneTime: request.oneTime ?? false,
              url: directUrl,
              variant
            }),
            resolvedOrigin: 'cdn_derived'
          }
        });
        await this.persistAuthorizationIdempotencyRecord(tx, {
          callerScopeKey: request.callerScopeKey,
          completedAt: request.now,
          idempotencyKey: request.idempotencyKey,
          normalizedOperationKey,
          normalizedRequestHash,
          operationKey,
          responsePayload: buildAuthorizationResponsePayload(authorization)
        });
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const concurrentReplay = await this.loadDeliveryAuthorizationReplay({
          callerScopeKey: request.callerScopeKey,
          idempotencyKey: request.idempotencyKey,
          normalizedRequestHash,
          operationKey
        });

        if (concurrentReplay) {
          return concurrentReplay;
        }
      }

      throw error;
    }

    return authorization;
  }

  async authorizeSource(
    assetId: string,
    versionId: string,
    preferredDisposition: 'attachment' | 'inline' | undefined,
    request: RegistryPublicAuthorizationRequest
  ): Promise<RegistrySourceAuthorizationRecord> {
    const operationKey = buildSourceAuthorizationOperationKey({ assetId, versionId });
    const normalizedOperationKey = `${operationKey}:${preferredDisposition ?? 'default'}:${request.oneTime === true ? 'one-time' : 'reusable'}`;
    const normalizedRequestHash = hashAuthorizationRequest({
      assetId,
      authorizationFamily: 'source',
      oneTime: request.oneTime === true,
      preferredDisposition: preferredDisposition ?? 'default',
      versionId
    });
    const replay = await this.loadSourceAuthorizationReplay({
      callerScopeKey: request.callerScopeKey,
      idempotencyKey: request.idempotencyKey,
      normalizedRequestHash,
      operationKey
    });

    if (replay) {
      return replay;
    }

    const version = await this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState === 'quarantined' || version.lifecycleState === 'purged') {
      throw new RegistryPublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    const expiresAt = new Date(request.now.getTime() + 15 * 60_000);
    const grantId = randomUUID();
    const proxyPath = `/v1/assets/${assetId}/versions/${versionId}/source/proxy?grantId=${grantId}${preferredDisposition ? `&disposition=${preferredDisposition}` : ''}`;
    const authorization: RegistrySourceAuthorizationRecord = {
      assetId,
      authorizationMode: 'signed-url',
      expiresAt,
      ...(request.oneTime ? { oneTime: true, remainingUses: 1 } : {}),
      resolvedOrigin: 'source-proxy',
      ...(version.tenantId ? { tenantId: version.tenantId } : {}),
      url: request.oneTime ? `/download-links/${grantId}` : proxyPath,
      versionId
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.sourceAccessGrant.create({
          data: {
            actorScopeKey: request.callerScopeKey,
            assetVersionId: versionId,
            authorizationMode: 'proxy_url',
            expiresAt,
            id: grantId,
            proxyPath,
            resolvedOrigin: ResolvedOrigin.source_proxy
          }
        });
        await tx.deliveryAuthorizationAudit.create({
          data: {
            actorScopeKey: request.callerScopeKey,
            assetVersionId: versionId,
            authorizationFamily: 'source',
            authorizationMode: 'proxy_url',
            expiresAt,
            grantId,
            requestMetadata: toInputJsonValue({
              idempotencyKey: request.idempotencyKey,
              preferredDisposition: preferredDisposition ?? 'default',
              url: authorization.url
            }),
            resolvedOrigin: 'source_proxy',
            sourceAccessGrantId: grantId
          }
        });
        await this.persistAuthorizationIdempotencyRecord(tx, {
          callerScopeKey: request.callerScopeKey,
          completedAt: request.now,
          idempotencyKey: request.idempotencyKey,
          normalizedOperationKey,
          normalizedRequestHash,
          operationKey,
          responsePayload: buildAuthorizationResponsePayload(authorization)
        });
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const concurrentReplay = await this.loadSourceAuthorizationReplay({
          callerScopeKey: request.callerScopeKey,
          idempotencyKey: request.idempotencyKey,
          normalizedRequestHash,
          operationKey
        });

        if (concurrentReplay) {
          return concurrentReplay;
        }
      }

      throw error;
    }

    return authorization;
  }

  async consumeDownloadLink(
    token: string,
    now: Date
  ): Promise<RegistryPublicDownloadLinkRecord> {
    const sourceGrant = await this.prisma.sourceAccessGrant.findFirst({
      where: {
        expiresAt: { gt: now },
        id: token
      }
    });

    if (sourceGrant) {
      await this.prisma.sourceAccessGrant.update({
        where: { id: sourceGrant.id },
        data: { expiresAt: now }
      });

      return {
        expiresAt: sourceGrant.expiresAt,
        token,
        url: sourceGrant.proxyPath ?? sourceGrant.exportObjectKey ?? `/v1/assets/${sourceGrant.assetVersionId}/source`
      };
    }

    const deliveryGrant = await this.prisma.deliveryAuthorizationAudit.findFirst({
      where: {
        expiresAt: { gt: now },
        grantId: token
      },
      orderBy: { grantedAt: 'desc' }
    });

    const url = extractUrlFromMetadata(deliveryGrant?.requestMetadata);

    if (!deliveryGrant || !deliveryGrant.expiresAt || !url) {
      throw new RegistryPublicDownloadLinkNotFoundError(token);
    }

    await this.prisma.deliveryAuthorizationAudit.update({
      where: { id: deliveryGrant.id },
      data: {
        expiresAt: now,
        requestMetadata: toInputJsonValue({
          ...(typeof deliveryGrant.requestMetadata === 'object' &&
          deliveryGrant.requestMetadata &&
          !Array.isArray(deliveryGrant.requestMetadata)
            ? (deliveryGrant.requestMetadata as Record<string, unknown>)
            : {}),
          consumedAt: now.toISOString(),
          url
        })
      }
    });

    return {
      expiresAt: deliveryGrant.expiresAt,
      token,
      url
    };
  }

  async getManifest(
    assetId: string,
    versionId: string,
    manifestType: string
  ): Promise<RegistryPublicManifestRecord | null> {
    await this.assertVersionPublished(assetId, versionId);

    const manifest = await this.prisma.assetManifest.findFirst({
      where: {
        assetVersionId: versionId,
        manifestType,
        assetVersion: { assetId }
      }
    });

    return manifest
      ? {
          assetId,
          deliveryScopeId: manifest.deliveryScopeId,
          manifestPayload:
            (manifest.manifestPayload as Record<string, unknown> | null) ?? {},
          manifestType: manifest.manifestType,
          objectKey: manifest.objectKey,
          versionId
        }
      : null;
  }

  async getVersion(
    assetId: string,
    versionId: string
  ): Promise<RegistryPublicAssetVersionRecord | null> {
    const version = await this.prisma.assetVersion.findFirst({
      where: {
        assetId,
        id: versionId
      },
      include: {
        asset: {
          include: {
            serviceNamespace: { select: { serviceNamespaceId: true } },
            tenantScope: { select: { externalTenantId: true } }
          }
        },
        manifests: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { manifestType: true }
        },
        workflowDispatches: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { dispatchState: true }
        },
        workflowRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { state: true }
        }
      }
    });

    if (!version) {
      return null;
    }

    return {
      assetId,
      assetOwner: version.asset.assetOwner,
      ...(version.canonicalSourceId &&
      version.canonicalSnapshotId &&
      version.canonicalLogicalPath &&
      version.repositoryEngine
        ? {
            canonicalSourceEvidence: {
              canonicalDigestSet: asChecksumArray(version.canonicalDigestSet),
              ...(version.canonicalLogicalByteLength === null
                ? {}
                : { canonicalLogicalByteLength: version.canonicalLogicalByteLength }),
              canonicalLogicalPath: version.canonicalLogicalPath,
              canonicalSnapshotId: version.canonicalSnapshotId,
              canonicalSourceId: version.canonicalSourceId,
              ...(version.canonicalStoredByteLength === null
                ? {}
                : { canonicalStoredByteLength: version.canonicalStoredByteLength }),
              ...(version.dedupeMetrics
                ? { dedupeMetrics: asRecord(version.dedupeMetrics) ?? {} }
                : {}),
              repositoryEngine: version.repositoryEngine,
              ...(version.sourceReconstructionHandles
                ? {
                    sourceReconstructionHandles:
                      asArray(version.sourceReconstructionHandles) ?? []
                  }
                : {}),
              ...(version.sourceSubstrateHints
                ? { sourceSubstrateHints: asRecord(version.sourceSubstrateHints) ?? {} }
                : {})
            }
          }
        : {}),
      ...(version.manifests[0] ? { defaultManifestType: version.manifests[0].manifestType } : {}),
      lifecycleState: mapLifecycleState(version.lifecycleState),
      serviceNamespaceId: version.asset.serviceNamespace.serviceNamespaceId,
      source: {
        byteLength: version.sourceByteLength,
        contentType: version.detectedContentType,
        filename: version.sourceFilename
      },
      ...(version.asset.tenantScope
        ? { tenantId: version.asset.tenantScope.externalTenantId }
        : {}),
      versionId,
      versionNumber: version.versionNumber,
      workflowState: version.workflowRuns[0]?.state ?? version.workflowDispatches[0]?.dispatchState ?? 'pending'
    };
  }

  async listDerivatives(
    assetId: string,
    versionId: string
  ): Promise<RegistryPublicDerivativeRecord[]> {
    await this.assertVersionPublished(assetId, versionId);

    const derivatives = await this.prisma.derivative.findMany({
      where: {
        assetVersionId: versionId,
        assetVersion: { assetId }
      },
      orderBy: { deterministicKey: 'asc' }
    });

    return derivatives.map((derivative) => ({
      assetId,
      byteLength: derivative.byteLength,
      contentType: derivative.contentType,
      deliveryScopeId: derivative.deliveryScopeId,
      deterministicKey: derivative.deterministicKey,
      derivativeId: derivative.id,
      recipeId: derivative.recipeId,
      storageKey: derivative.storageKey ?? '',
      variant: derivative.variantKey,
      versionId
    }));
  }

  private async assertVersionPublished(assetId: string, versionId: string) {
    const version = await this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState !== 'published') {
      throw new RegistryPublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }
  }

  private buildDeliveryUrl(
    deliveryScope: {
      hostname: string;
      pathPrefix: string | null;
    },
    storageKey: string | null
  ) {
    const normalizedPrefix = deliveryScope.pathPrefix
      ? `/${deliveryScope.pathPrefix.replace(/^\/+|\/+$/gu, '')}`
      : '';

    return `https://${deliveryScope.hostname}${normalizedPrefix}/${(storageKey ?? '').replace(/^\/+/gu, '')}`;
  }

  private async getRequiredVersion(assetId: string, versionId: string) {
    const version = await this.getVersion(assetId, versionId);

    if (!version) {
      throw new RegistryPublicAssetVersionNotFoundError(assetId, versionId);
    }

    return version;
  }

  private async loadDeliveryAuthorizationReplay(input: {
    callerScopeKey: string;
    idempotencyKey: string;
    normalizedRequestHash: string;
    operationKey: string;
  }) {
    const replayRecord = await this.prisma.idempotencyRecord.findUnique({
      where: {
        apiSurface_callerScopeKey_operationKey_idempotencyKey: {
          apiSurface: 'public',
          callerScopeKey: input.callerScopeKey,
          idempotencyKey: input.idempotencyKey,
          operationKey: input.operationKey
        }
      }
    });

    if (!replayRecord) {
      return undefined;
    }

    if (replayRecord.normalizedRequestHash !== input.normalizedRequestHash) {
      throw new RegistryPublicReadIdempotencyConflictError(input.idempotencyKey);
    }

    return buildDeliveryAuthorizationReplay(replayRecord.responsePayload);
  }

  private async loadSourceAuthorizationReplay(input: {
    callerScopeKey: string;
    idempotencyKey: string;
    normalizedRequestHash: string;
    operationKey: string;
  }) {
    const replayRecord = await this.prisma.idempotencyRecord.findUnique({
      where: {
        apiSurface_callerScopeKey_operationKey_idempotencyKey: {
          apiSurface: 'public',
          callerScopeKey: input.callerScopeKey,
          idempotencyKey: input.idempotencyKey,
          operationKey: input.operationKey
        }
      }
    });

    if (!replayRecord) {
      return undefined;
    }

    if (replayRecord.normalizedRequestHash !== input.normalizedRequestHash) {
      throw new RegistryPublicReadIdempotencyConflictError(input.idempotencyKey);
    }

    return buildSourceAuthorizationReplay(replayRecord.responsePayload);
  }

  private async persistAuthorizationIdempotencyRecord(
    tx: Prisma.TransactionClient,
    input: {
      callerScopeKey: string;
      completedAt: Date;
      idempotencyKey: string;
      normalizedOperationKey: string;
      normalizedRequestHash: string;
      operationKey: string;
      responsePayload: Record<string, unknown>;
    }
  ) {
    await tx.idempotencyRecord.create({
      data: {
        apiSurface: 'public',
        callerScopeKey: input.callerScopeKey,
        completedAt: input.completedAt,
        idempotencyKey: input.idempotencyKey,
        isTerminal: true,
        normalizedOperationKey: input.normalizedOperationKey,
        normalizedRequestHash: input.normalizedRequestHash,
        operationKey: input.operationKey,
        responsePayload: toInputJsonValue(input.responsePayload)
      }
    });
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
