/**
 * Purpose: Defines the registry-side publication store contract and an in-memory implementation for the presentation normalization slice.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.postgresql.org/docs/
 * Tests:
 * - packages/registry/test/presentation-publication-store.test.mjs
 */

export type PresentationVersionLifecycleState = 'canonical' | 'processing' | 'published';

export interface CanonicalPresentationVersionRecord {
  assetId: string;
  canonicalLogicalPath: string;
  canonicalSourceId: string;
  detectedContentType: string;
  lifecycleState: PresentationVersionLifecycleState;
  serviceNamespaceId: string;
  sourceByteLength: bigint;
  sourceChecksumValue: string;
  sourceFilename: string;
  versionId: string;
  versionNumber: number;
}

export interface PublishedPresentationDerivativeRecord {
  assetVersionId: string;
  byteLength: bigint;
  checksumValue: string;
  contentType: string;
  deliveryScopeId: string;
  deterministicKey: string;
  pageNumber?: number;
  publicationState: 'published';
  publishedAt: Date;
  recipeId: string;
  schemaVersion: string;
  storageBucket: string;
  storageKey: string;
  variantKey: string;
}

export interface PublishedPresentationManifestRecord {
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

export interface BeginPresentationPublicationInput {
  startedAt: Date;
  versionId: string;
  workflowId: string;
}

export interface PublishPresentationVersionInput {
  deliveryScopeId: string;
  derivatives: PublishedPresentationDerivativeRecord[];
  manifest: PublishedPresentationManifestRecord;
  publishedAt: Date;
  versionId: string;
  workflowId: string;
}

export interface PresentationPublicationStore {
  beginPresentationPublication(input: BeginPresentationPublicationInput): Promise<CanonicalPresentationVersionRecord>;
  getVersion(versionId: string): Promise<CanonicalPresentationVersionRecord | null>;
  listPublishedDerivatives(versionId: string): Promise<PublishedPresentationDerivativeRecord[]>;
  publishPresentationVersion(input: PublishPresentationVersionInput): Promise<CanonicalPresentationVersionRecord>;
  readManifest(
    versionId: string,
    manifestType: string,
    deliveryScopeId: string
  ): Promise<PublishedPresentationManifestRecord | null>;
}

export interface SeedCanonicalPresentationVersionRecord {
  assetId: string;
  canonicalLogicalPath: string;
  canonicalSourceId: string;
  detectedContentType: string;
  lifecycleState?: PresentationVersionLifecycleState;
  serviceNamespaceId: string;
  sourceByteLength: bigint;
  sourceChecksumValue: string;
  sourceFilename: string;
  versionId: string;
  versionNumber: number;
}

export interface InMemoryPresentationPublicationStoreOptions {
  versions?: SeedCanonicalPresentationVersionRecord[];
}

export class PresentationVersionNotFoundError extends Error {
  constructor(readonly versionId: string) {
    super(`Presentation version "${versionId}" does not exist.`);
    this.name = 'PresentationVersionNotFoundError';
  }
}

export class PresentationVersionStateError extends Error {
  constructor(readonly versionId: string, readonly lifecycleState: string, readonly action: string) {
    super(`Presentation version "${versionId}" cannot ${action} from lifecycle state "${lifecycleState}".`);
    this.name = 'PresentationVersionStateError';
  }
}

function cloneDate(value: Date): Date {
  return new Date(value);
}

function cloneVersion(record: CanonicalPresentationVersionRecord): CanonicalPresentationVersionRecord {
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

function cloneDerivative(
  record: PublishedPresentationDerivativeRecord
): PublishedPresentationDerivativeRecord {
  return {
    assetVersionId: record.assetVersionId,
    byteLength: record.byteLength,
    checksumValue: record.checksumValue,
    contentType: record.contentType,
    deliveryScopeId: record.deliveryScopeId,
    deterministicKey: record.deterministicKey,
    ...(record.pageNumber === undefined ? {} : { pageNumber: record.pageNumber }),
    publicationState: 'published',
    publishedAt: cloneDate(record.publishedAt),
    recipeId: record.recipeId,
    schemaVersion: record.schemaVersion,
    storageBucket: record.storageBucket,
    storageKey: record.storageKey,
    variantKey: record.variantKey
  };
}

function cloneManifest(record: PublishedPresentationManifestRecord): PublishedPresentationManifestRecord {
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

export class InMemoryPresentationPublicationStore implements PresentationPublicationStore {
  private readonly derivativesByKey = new Map<string, PublishedPresentationDerivativeRecord>();
  private readonly manifestsByKey = new Map<string, PublishedPresentationManifestRecord>();
  private readonly versions = new Map<string, CanonicalPresentationVersionRecord>();

  constructor(options: InMemoryPresentationPublicationStoreOptions = {}) {
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

  async beginPresentationPublication(
    input: BeginPresentationPublicationInput
  ): Promise<CanonicalPresentationVersionRecord> {
    const version = this.getMutableVersion(input.versionId);

    if (version.lifecycleState !== 'canonical' && version.lifecycleState !== 'published') {
      throw new PresentationVersionStateError(input.versionId, version.lifecycleState, 'begin processing');
    }

    version.lifecycleState = 'processing';
    return cloneVersion(version);
  }

  async getVersion(versionId: string): Promise<CanonicalPresentationVersionRecord | null> {
    const version = this.versions.get(versionId);
    return version ? cloneVersion(version) : null;
  }

  async listPublishedDerivatives(versionId: string): Promise<PublishedPresentationDerivativeRecord[]> {
    return [...this.derivativesByKey.values()]
      .filter((derivative) => derivative.assetVersionId === versionId)
      .sort((left, right) => left.deterministicKey.localeCompare(right.deterministicKey))
      .map((record) => cloneDerivative(record));
  }

  async publishPresentationVersion(
    input: PublishPresentationVersionInput
  ): Promise<CanonicalPresentationVersionRecord> {
    const version = this.getMutableVersion(input.versionId);

    if (version.lifecycleState !== 'processing' && version.lifecycleState !== 'published') {
      throw new PresentationVersionStateError(input.versionId, version.lifecycleState, 'publish derivatives');
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
  ): Promise<PublishedPresentationManifestRecord | null> {
    const manifest = this.manifestsByKey.get(`${versionId}:${deliveryScopeId}:${manifestType}`);
    return manifest ? cloneManifest(manifest) : null;
  }

  private getMutableVersion(versionId: string): CanonicalPresentationVersionRecord {
    const version = this.versions.get(versionId);

    if (!version) {
      throw new PresentationVersionNotFoundError(versionId);
    }

    return version;
  }
}
