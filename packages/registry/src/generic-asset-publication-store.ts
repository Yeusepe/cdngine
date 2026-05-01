/**
 * Purpose: Defines the generic asset publication store contract and an in-memory implementation for preserve-original fallback publication.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.postgresql.org/docs/
 * Tests:
 * - packages/registry/test/generic-asset-publication-store.test.mjs
 */

export type GenericAssetVersionLifecycleState = 'canonical' | 'processing' | 'published';

export interface GenericCanonicalSourceEvidenceRecord {
  repositoryEngine: 'kopia' | 'xet' | 'restic' | 'borg' | 'casync' | 'custom';
  canonicalSourceId: string;
  canonicalSnapshotId: string;
  canonicalLogicalPath: string;
  canonicalDigestSet: Array<{ algorithm: 'sha256'; value: string }>;
  canonicalLogicalByteLength?: bigint;
  canonicalStoredByteLength?: bigint;
  dedupeMetrics?: Record<string, unknown>;
  sourceReconstructionHandles?: Array<{
    kind: 'snapshot' | 'manifest' | 'chunk-index' | 'merkle-root' | 'opaque';
    value: string;
  }>;
  sourceSubstrateHints?: Record<string, string>;
}

export interface CanonicalGenericAssetVersionRecord {
  assetId: string;
  canonicalSourceEvidence: GenericCanonicalSourceEvidenceRecord;
  detectedContentType: string;
  lifecycleState: GenericAssetVersionLifecycleState;
  serviceNamespaceId: string;
  sourceByteLength: bigint;
  sourceChecksumValue: string;
  sourceFilename: string;
  versionId: string;
  versionNumber: number;
}

export interface PublishedGenericAssetDerivativeRecord {
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

export interface PublishedGenericAssetManifestRecord {
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

export interface BeginGenericAssetPublicationInput {
  startedAt: Date;
  versionId: string;
  workflowId: string;
}

export interface PublishGenericAssetVersionInput {
  deliveryScopeId: string;
  derivatives: PublishedGenericAssetDerivativeRecord[];
  manifest: PublishedGenericAssetManifestRecord;
  publishedAt: Date;
  versionId: string;
  workflowId: string;
}

export interface GenericAssetPublicationStore {
  beginGenericAssetPublication(
    input: BeginGenericAssetPublicationInput
  ): Promise<CanonicalGenericAssetVersionRecord>;
  getVersion(versionId: string): Promise<CanonicalGenericAssetVersionRecord | null>;
  listPublishedDerivatives(versionId: string): Promise<PublishedGenericAssetDerivativeRecord[]>;
  publishGenericAssetVersion(
    input: PublishGenericAssetVersionInput
  ): Promise<CanonicalGenericAssetVersionRecord>;
  readManifest(
    versionId: string,
    manifestType: string,
    deliveryScopeId: string
  ): Promise<PublishedGenericAssetManifestRecord | null>;
}

export interface SeedCanonicalGenericAssetVersionRecord {
  assetId: string;
  canonicalSourceEvidence: GenericCanonicalSourceEvidenceRecord;
  detectedContentType: string;
  lifecycleState?: GenericAssetVersionLifecycleState;
  serviceNamespaceId: string;
  sourceByteLength: bigint;
  sourceChecksumValue: string;
  sourceFilename: string;
  versionId: string;
  versionNumber: number;
}

export interface InMemoryGenericAssetPublicationStoreOptions {
  versions?: SeedCanonicalGenericAssetVersionRecord[];
}

export class GenericAssetVersionNotFoundError extends Error {
  constructor(readonly versionId: string) {
    super(`Generic asset version "${versionId}" does not exist.`);
    this.name = 'GenericAssetVersionNotFoundError';
  }
}

export class GenericAssetVersionStateError extends Error {
  constructor(readonly versionId: string, readonly lifecycleState: string, readonly action: string) {
    super(`Generic asset version "${versionId}" cannot ${action} from lifecycle state "${lifecycleState}".`);
    this.name = 'GenericAssetVersionStateError';
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

function cloneCanonicalSourceEvidence(
  record: GenericCanonicalSourceEvidenceRecord
): GenericCanonicalSourceEvidenceRecord {
  return {
    repositoryEngine: record.repositoryEngine,
    canonicalSourceId: record.canonicalSourceId,
    canonicalSnapshotId: record.canonicalSnapshotId,
    canonicalLogicalPath: record.canonicalLogicalPath,
    canonicalDigestSet: record.canonicalDigestSet.map((digest) => ({ ...digest })),
    ...(record.canonicalLogicalByteLength === undefined
      ? {}
      : { canonicalLogicalByteLength: record.canonicalLogicalByteLength }),
    ...(record.canonicalStoredByteLength === undefined
      ? {}
      : { canonicalStoredByteLength: record.canonicalStoredByteLength }),
    ...(record.dedupeMetrics ? { dedupeMetrics: { ...record.dedupeMetrics } } : {}),
    ...(record.sourceReconstructionHandles
      ? {
          sourceReconstructionHandles: record.sourceReconstructionHandles.map((handle) => ({
            kind: handle.kind,
            value: handle.value
          }))
        }
      : {}),
    ...(record.sourceSubstrateHints
      ? { sourceSubstrateHints: { ...record.sourceSubstrateHints } }
      : {})
  };
}

function cloneVersion(record: CanonicalGenericAssetVersionRecord): CanonicalGenericAssetVersionRecord {
  return {
    assetId: record.assetId,
    canonicalSourceEvidence: cloneCanonicalSourceEvidence(record.canonicalSourceEvidence),
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
  record: PublishedGenericAssetDerivativeRecord
): PublishedGenericAssetDerivativeRecord {
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

function cloneManifest(
  record: PublishedGenericAssetManifestRecord
): PublishedGenericAssetManifestRecord {
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

export class InMemoryGenericAssetPublicationStore implements GenericAssetPublicationStore {
  private readonly derivativesByKey = new Map<string, PublishedGenericAssetDerivativeRecord>();
  private readonly manifestsByKey = new Map<string, PublishedGenericAssetManifestRecord>();
  private readonly versions = new Map<string, CanonicalGenericAssetVersionRecord>();

  constructor(options: InMemoryGenericAssetPublicationStoreOptions = {}) {
    for (const version of options.versions ?? []) {
      this.versions.set(version.versionId, {
        assetId: version.assetId,
        canonicalSourceEvidence: cloneCanonicalSourceEvidence(version.canonicalSourceEvidence),
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

  async beginGenericAssetPublication(
    input: BeginGenericAssetPublicationInput
  ): Promise<CanonicalGenericAssetVersionRecord> {
    const version = this.getMutableVersion(input.versionId);

    if (version.lifecycleState !== 'canonical' && version.lifecycleState !== 'published') {
      throw new GenericAssetVersionStateError(
        input.versionId,
        version.lifecycleState,
        'begin processing'
      );
    }

    version.lifecycleState = 'processing';
    return cloneVersion(version);
  }

  async getVersion(versionId: string): Promise<CanonicalGenericAssetVersionRecord | null> {
    const version = this.versions.get(versionId);
    return version ? cloneVersion(version) : null;
  }

  async listPublishedDerivatives(
    versionId: string
  ): Promise<PublishedGenericAssetDerivativeRecord[]> {
    return [...this.derivativesByKey.values()]
      .filter((derivative) => derivative.assetVersionId === versionId)
      .sort((left, right) => left.deterministicKey.localeCompare(right.deterministicKey))
      .map((record) => cloneDerivative(record));
  }

  async publishGenericAssetVersion(
    input: PublishGenericAssetVersionInput
  ): Promise<CanonicalGenericAssetVersionRecord> {
    const version = this.getMutableVersion(input.versionId);

    if (version.lifecycleState !== 'processing' && version.lifecycleState !== 'published') {
      throw new GenericAssetVersionStateError(
        input.versionId,
        version.lifecycleState,
        'publish derivatives'
      );
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
  ): Promise<PublishedGenericAssetManifestRecord | null> {
    const manifest = this.manifestsByKey.get(`${versionId}:${deliveryScopeId}:${manifestType}`);
    return manifest ? cloneManifest(manifest) : null;
  }

  private getMutableVersion(versionId: string): CanonicalGenericAssetVersionRecord {
    const version = this.versions.get(versionId);

    if (!version) {
      throw new GenericAssetVersionNotFoundError(versionId);
    }

    return version;
  }
}
