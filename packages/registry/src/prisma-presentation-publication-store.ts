/**
 * Purpose: Persists presentation publication state, normalized outputs, and manifests into the durable registry so worker execution advances canonical versions through processing to published.
 * Governing docs:
 * - docs/persistence-model.md
 * - docs/service-architecture.md
 * - docs/workflow-extensibility.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * Tests:
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

import { Prisma } from './generated/prisma/client.js';
import { AssetVersionState, PublicationState } from './generated/prisma/enums.js';
import { createRegistryPrismaClient, type RegistryPrismaClient } from './prisma-client.js';
import {
  PresentationVersionNotFoundError,
  PresentationVersionStateError,
  type CanonicalPresentationVersionRecord,
  type PresentationPublicationStore,
  type PublishedPresentationDerivativeRecord,
  type PublishedPresentationManifestRecord
} from './presentation-publication-store.js';

function asRecord(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
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

function mapVersion(record: {
  assetId: string;
  canonicalLogicalPath: string | null;
  canonicalSourceId: string | null;
  detectedContentType: string;
  lifecycleState: string;
  sourceByteLength: bigint;
  sourceChecksumValue: string;
  sourceFilename: string;
  versionNumber: number;
  asset: {
    serviceNamespace: {
      serviceNamespaceId: string;
    };
  };
  id: string;
}): CanonicalPresentationVersionRecord {
  if (!record.canonicalLogicalPath || !record.canonicalSourceId) {
    throw new Error(`Presentation version "${record.id}" is missing canonical source identity.`);
  }

  return {
    assetId: record.assetId,
    canonicalLogicalPath: record.canonicalLogicalPath,
    canonicalSourceId: record.canonicalSourceId,
    detectedContentType: record.detectedContentType,
    lifecycleState:
      record.lifecycleState === AssetVersionState.published
        ? 'published'
        : record.lifecycleState === AssetVersionState.processing
          ? 'processing'
          : 'canonical',
    serviceNamespaceId: record.asset.serviceNamespace.serviceNamespaceId,
    sourceByteLength: record.sourceByteLength,
    sourceChecksumValue: record.sourceChecksumValue,
    sourceFilename: record.sourceFilename,
    versionId: record.id,
    versionNumber: record.versionNumber
  };
}

function mapDerivative(record: {
  assetVersionId: string;
  byteLength: bigint;
  checksumValue: string | null;
  contentType: string;
  deliveryScopeId: string;
  deterministicKey: string;
  publishedAt: Date | null;
  recipeId: string;
  schemaVersion: string;
  storageBucket: string | null;
  storageKey: string | null;
  variantKey: string;
}): PublishedPresentationDerivativeRecord {
  const parsedPageNumber =
    record.recipeId === 'slide-images'
      ? Number.parseInt(record.variantKey.replace(/^slide-/u, ''), 10)
      : 0;

  return {
    assetVersionId: record.assetVersionId,
    byteLength: record.byteLength,
    checksumValue: record.checksumValue ?? '',
    contentType: record.contentType,
    deliveryScopeId: record.deliveryScopeId,
    deterministicKey: record.deterministicKey,
    ...(Number.isFinite(parsedPageNumber) ? { pageNumber: parsedPageNumber } : {}),
    publicationState: 'published',
    publishedAt: record.publishedAt ?? new Date(0),
    recipeId: record.recipeId,
    schemaVersion: record.schemaVersion,
    storageBucket: record.storageBucket ?? '',
    storageKey: record.storageKey ?? '',
    variantKey: record.variantKey
  };
}

function mapManifest(record: {
  assetVersionId: string;
  checksumValue: string | null;
  deliveryScopeId: string;
  manifestPayload: Prisma.JsonValue | null;
  manifestType: string;
  objectKey: string;
  publishedAt: Date | null;
  schemaVersion: string;
}): PublishedPresentationManifestRecord {
  return {
    assetVersionId: record.assetVersionId,
    checksumValue: record.checksumValue ?? '',
    deliveryScopeId: record.deliveryScopeId,
    manifestPayload: asRecord(record.manifestPayload) ?? {},
    manifestType: record.manifestType,
    objectKey: record.objectKey,
    publicationState: 'published',
    publishedAt: record.publishedAt ?? new Date(0),
    schemaVersion: record.schemaVersion
  };
}

export class PrismaPresentationPublicationStore implements PresentationPublicationStore {
  constructor(
    private readonly options: {
      prisma?: RegistryPrismaClient;
    } = {}
  ) {}

  private get prisma() {
    return this.options.prisma ?? createRegistryPrismaClient();
  }

  async beginPresentationPublication(input: {
    startedAt: Date;
    versionId: string;
    workflowId: string;
  }): Promise<CanonicalPresentationVersionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.assetVersion.findUnique({
        where: { id: input.versionId },
        include: {
          asset: {
            include: {
              serviceNamespace: { select: { serviceNamespaceId: true } }
            }
          }
        }
      });

      if (!version) {
        throw new PresentationVersionNotFoundError(input.versionId);
      }

      if (
        version.lifecycleState !== AssetVersionState.canonical &&
        version.lifecycleState !== AssetVersionState.processing &&
        version.lifecycleState !== AssetVersionState.published
      ) {
        throw new PresentationVersionStateError(
          input.versionId,
          version.lifecycleState,
          'begin processing'
        );
      }

      if (version.lifecycleState !== AssetVersionState.processing) {
        await tx.assetVersion.update({
          where: { id: input.versionId },
          data: {
            lifecycleState: AssetVersionState.processing
          }
        });
      }

      return mapVersion({
        ...version,
        lifecycleState: AssetVersionState.processing
      });
    });
  }

  async getVersion(versionId: string): Promise<CanonicalPresentationVersionRecord | null> {
    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      include: {
        asset: {
          include: {
            serviceNamespace: { select: { serviceNamespaceId: true } }
          }
        }
      }
    });

    return version ? mapVersion(version) : null;
  }

  async listPublishedDerivatives(versionId: string): Promise<PublishedPresentationDerivativeRecord[]> {
    const derivatives = await this.prisma.derivative.findMany({
      where: {
        assetVersionId: versionId,
        publicationState: PublicationState.published
      },
      orderBy: { deterministicKey: 'asc' }
    });

    return derivatives.map((derivative) => mapDerivative(derivative));
  }

  async publishPresentationVersion(input: {
    deliveryScopeId: string;
    derivatives: PublishedPresentationDerivativeRecord[];
    manifest: PublishedPresentationManifestRecord;
    publishedAt: Date;
    versionId: string;
    workflowId: string;
  }): Promise<CanonicalPresentationVersionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.assetVersion.findUnique({
        where: { id: input.versionId },
        include: {
          asset: {
            include: {
              serviceNamespace: { select: { serviceNamespaceId: true } }
            }
          }
        }
      });

      if (!version) {
        throw new PresentationVersionNotFoundError(input.versionId);
      }

      if (
        version.lifecycleState !== AssetVersionState.processing &&
        version.lifecycleState !== AssetVersionState.published
      ) {
        throw new PresentationVersionStateError(
          input.versionId,
          version.lifecycleState,
          'publish derivatives'
        );
      }

      const deliveryScope = await tx.deliveryScope.findFirst({
        where: {
          id: input.deliveryScopeId,
          serviceNamespaceId: version.asset.serviceNamespaceId,
          ...(version.asset.tenantScopeId
            ? {
                OR: [
                  { tenantScopeId: null },
                  { tenantScopeId: version.asset.tenantScopeId }
                ]
              }
            : { tenantScopeId: null })
        },
        select: { id: true }
      });

      if (!deliveryScope) {
        throw new Error(
          `Delivery scope "${input.deliveryScopeId}" is not available for presentation version "${input.versionId}".`
        );
      }

      for (const derivative of input.derivatives) {
        await tx.derivative.upsert({
          where: {
            assetVersionId_deliveryScopeId_recipeId_schemaVersion_variantKey: {
              assetVersionId: input.versionId,
              deliveryScopeId: derivative.deliveryScopeId,
              recipeId: derivative.recipeId,
              schemaVersion: derivative.schemaVersion,
              variantKey: derivative.variantKey
            }
          },
          update: {
            byteLength: derivative.byteLength,
            checksumValue: derivative.checksumValue,
            contentType: derivative.contentType,
            deterministicKey: derivative.deterministicKey,
            publicationState: PublicationState.published,
            publishedAt: derivative.publishedAt,
            storageBucket: derivative.storageBucket,
            storageKey: derivative.storageKey
          },
          create: {
            assetVersionId: input.versionId,
            byteLength: derivative.byteLength,
            checksumValue: derivative.checksumValue,
            contentType: derivative.contentType,
            deliveryScopeId: derivative.deliveryScopeId,
            deterministicKey: derivative.deterministicKey,
            publicationState: PublicationState.published,
            publishedAt: derivative.publishedAt,
            recipeId: derivative.recipeId,
            schemaVersion: derivative.schemaVersion,
            storageBucket: derivative.storageBucket,
            storageKey: derivative.storageKey,
            variantKey: derivative.variantKey
          }
        });
      }

      await tx.assetManifest.upsert({
        where: {
          assetVersionId_manifestType_deliveryScopeId: {
            assetVersionId: input.versionId,
            deliveryScopeId: input.deliveryScopeId,
            manifestType: input.manifest.manifestType
          }
        },
        update: {
          checksumValue: input.manifest.checksumValue,
          manifestPayload: toJsonValue(input.manifest.manifestPayload),
          objectKey: input.manifest.objectKey,
          publicationState: PublicationState.published,
          publishedAt: input.manifest.publishedAt,
          schemaVersion: input.manifest.schemaVersion
        },
        create: {
          assetVersionId: input.versionId,
          checksumValue: input.manifest.checksumValue,
          deliveryScopeId: input.deliveryScopeId,
          manifestPayload: toJsonValue(input.manifest.manifestPayload),
          manifestType: input.manifest.manifestType,
          objectKey: input.manifest.objectKey,
          publicationState: PublicationState.published,
          publishedAt: input.manifest.publishedAt,
          schemaVersion: input.manifest.schemaVersion
        }
      });

      await tx.assetVersion.update({
        where: { id: input.versionId },
        data: {
          lifecycleState: AssetVersionState.published
        }
      });

      return mapVersion({
        ...version,
        lifecycleState: AssetVersionState.published
      });
    });
  }

  async readManifest(
    versionId: string,
    manifestType: string,
    deliveryScopeId: string
  ): Promise<PublishedPresentationManifestRecord | null> {
    const manifest = await this.prisma.assetManifest.findUnique({
      where: {
        assetVersionId_manifestType_deliveryScopeId: {
          assetVersionId: versionId,
          deliveryScopeId,
          manifestType
        }
      }
    });

    return manifest ? mapManifest(manifest) : null;
  }
}

