/**
 * Purpose: Defines the registry-side publication store contract and an in-memory implementation for the first image vertical slice.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * - docs/adr/0003-deterministic-derivative-keys.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.postgresql.org/docs/
 * Tests:
 * - packages/registry/test/image-publication-store.test.mjs
 */

export type ImageVersionLifecycleState = 'canonical' | 'processing' | 'published';

export interface CanonicalImageVersionRecord {
  assetId: string;
  canonicalLogicalPath: string;
  canonicalSourceId: string;
  detectedContentType: string;
  lifecycleState: ImageVersionLifecycleState;
  serviceNamespaceId: string;
  sourceByteLength: bigint;
  sourceChecksumValue: string;
  sourceFilename: string;
  versionId: string;
  versionNumber: number;
}

export interface PublishedDerivativeRecord {
  assetVersionId: string;
  byteLength: bigint;
  checksumValue: string;
  contentType: string;
  deliveryScopeId: string;
  deterministicKey: string;
  metadata?: Record<string, unknown>;
  publicationState: 'published';
  publishedAt: Date;
  recipeId: string;
  schemaVersion: string;
  storageBucket: string;
  storageKey: string;
  variantKey: string;
}

export interface PublishedManifestRecord {
  assetVersionId: string;
  checksumValue: string;
  deliveryScopeId: string;
  manifestPayload: Record<string, unknown>;
  manifestType: string;
  objectKey: string;
  publicationState: 'published';
  publishedAt: Date;
  schemaVersion: string;
}

export interface BeginImagePublicationInput {
  startedAt: Date;
  versionId: string;
  workflowId: string;
}

export interface PublishImageVersionInput {
  deliveryScopeId: string;
  derivatives: PublishedDerivativeRecord[];
  manifest: PublishedManifestRecord;
  publishedAt: Date;
  versionId: string;
  workflowId: string;
}

export interface ImagePublicationStore {
  beginImagePublication(input: BeginImagePublicationInput): Promise<CanonicalImageVersionRecord>;
  getVersion(versionId: string): Promise<CanonicalImageVersionRecord | null>;
  listPublishedDerivatives(versionId: string): Promise<PublishedDerivativeRecord[]>;
  publishImageVersion(input: PublishImageVersionInput): Promise<CanonicalImageVersionRecord>;
  readManifest(
    versionId: string,
    manifestType: string,
    deliveryScopeId: string
  ): Promise<PublishedManifestRecord | null>;
}

export interface SeedCanonicalImageVersionRecord {
  assetId: string;
  canonicalLogicalPath: string;
  canonicalSourceId: string;
  detectedContentType: string;
  lifecycleState?: ImageVersionLifecycleState;
  serviceNamespaceId: string;
  sourceByteLength: bigint;
  sourceChecksumValue: string;
  sourceFilename: string;
  versionId: string;
  versionNumber: number;
}

export interface InMemoryImagePublicationStoreOptions {
  versions?: SeedCanonicalImageVersionRecord[];
}

export class ImageVersionNotFoundError extends Error {
  constructor(readonly versionId: string) {
    super(`Image version "${versionId}" does not exist.`);
    this.name = 'ImageVersionNotFoundError';
  }
}

export class ImageVersionStateError extends Error {
  constructor(readonly versionId: string, readonly lifecycleState: string, readonly action: string) {
    super(`Image version "${versionId}" cannot ${action} from lifecycle state "${lifecycleState}".`);
    this.name = 'ImageVersionStateError';
  }
}

function cloneDate(value: Date): Date {
  return new Date(value);
}

function cloneJsonRecord(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return { ...value };
}

function cloneVersion(record: CanonicalImageVersionRecord): CanonicalImageVersionRecord {
  return {
    assetId: record.assetId,
    canonicalLogicalPath: record.canonicalLogicalPath,
    canonicalSourceId: record.canonicalSourceId,
    detectedContentType: record.detectedContentType,
    lifecycleState: record.lifecycleState,
    serviceNamespaceId: record.serviceNamespaceId,
    sourceByteLength: record.sourceByteLength,
    sourceChecksumValue: record.sourceChecksumValue,
    sourceFilename: record.sourceFilename,
    versionId: record.versionId,
    versionNumber: record.versionNumber
  };
}

function cloneDerivative(record: PublishedDerivativeRecord): PublishedDerivativeRecord {
  return {
    assetVersionId: record.assetVersionId,
    byteLength: record.byteLength,
    checksumValue: record.checksumValue,
    contentType: record.contentType,
    deliveryScopeId: record.deliveryScopeId,
    deterministicKey: record.deterministicKey,
    ...(record.metadata ? { metadata: cloneJsonRecord(record.metadata) ?? {} } : {}),
    publicationState: 'published',
    publishedAt: cloneDate(record.publishedAt),
    recipeId: record.recipeId,
    schemaVersion: record.schemaVersion,
    storageBucket: record.storageBucket,
    storageKey: record.storageKey,
    variantKey: record.variantKey
  };
}

function cloneManifest(record: PublishedManifestRecord): PublishedManifestRecord {
  return {
    assetVersionId: record.assetVersionId,
    checksumValue: record.checksumValue,
    deliveryScopeId: record.deliveryScopeId,
    manifestPayload: { ...record.manifestPayload },
    manifestType: record.manifestType,
    objectKey: record.objectKey,
    publicationState: 'published',
    publishedAt: cloneDate(record.publishedAt),
    schemaVersion: record.schemaVersion
  };
}

export class InMemoryImagePublicationStore implements ImagePublicationStore {
  private readonly derivativesByKey = new Map<string, PublishedDerivativeRecord>();
  private readonly manifestsByKey = new Map<string, PublishedManifestRecord>();
  private readonly versions = new Map<string, CanonicalImageVersionRecord>();

  constructor(options: InMemoryImagePublicationStoreOptions = {}) {
    for (const version of options.versions ?? []) {
      this.versions.set(version.versionId, {
        assetId: version.assetId,
        canonicalLogicalPath: version.canonicalLogicalPath,
        canonicalSourceId: version.canonicalSourceId,
        detectedContentType: version.detectedContentType,
        lifecycleState: version.lifecycleState ?? 'canonical',
        serviceNamespaceId: version.serviceNamespaceId,
        sourceByteLength: version.sourceByteLength,
        sourceChecksumValue: version.sourceChecksumValue,
        sourceFilename: version.sourceFilename,
        versionId: version.versionId,
        versionNumber: version.versionNumber
      });
    }
  }

  async beginImagePublication(input: BeginImagePublicationInput): Promise<CanonicalImageVersionRecord> {
    const version = this.getMutableVersion(input.versionId);

    if (version.lifecycleState !== 'canonical' && version.lifecycleState !== 'published') {
      throw new ImageVersionStateError(input.versionId, version.lifecycleState, 'begin processing');
    }

    version.lifecycleState = 'processing';
    return cloneVersion(version);
  }

  async getVersion(versionId: string): Promise<CanonicalImageVersionRecord | null> {
    const version = this.versions.get(versionId);
    return version ? cloneVersion(version) : null;
  }

  async listPublishedDerivatives(versionId: string): Promise<PublishedDerivativeRecord[]> {
    return [...this.derivativesByKey.values()]
      .filter((derivative) => derivative.assetVersionId === versionId)
      .sort((left, right) => left.deterministicKey.localeCompare(right.deterministicKey))
      .map((record) => cloneDerivative(record));
  }

  async publishImageVersion(input: PublishImageVersionInput): Promise<CanonicalImageVersionRecord> {
    const version = this.getMutableVersion(input.versionId);

    if (version.lifecycleState !== 'processing' && version.lifecycleState !== 'published') {
      throw new ImageVersionStateError(input.versionId, version.lifecycleState, 'publish derivatives');
    }

    for (const derivative of input.derivatives) {
      this.derivativesByKey.set(derivative.deterministicKey, cloneDerivative(derivative));
    }

    this.manifestsByKey.set(
      `${input.versionId}:${input.deliveryScopeId}:${input.manifest.manifestType}`,
      cloneManifest(input.manifest)
    );
    version.lifecycleState = 'published';

    return cloneVersion(version);
  }

  async readManifest(
    versionId: string,
    manifestType: string,
    deliveryScopeId: string
  ): Promise<PublishedManifestRecord | null> {
    const manifest = this.manifestsByKey.get(`${versionId}:${deliveryScopeId}:${manifestType}`);
    return manifest ? cloneManifest(manifest) : null;
  }

  private getMutableVersion(versionId: string): CanonicalImageVersionRecord {
    const version = this.versions.get(versionId);

    if (!version) {
      throw new ImageVersionNotFoundError(versionId);
    }

    return version;
  }
}
