/**
 * Purpose: Normalizes one-bucket and multi-bucket storage layouts into stable logical storage-role targets for staging, canonical source, derived delivery, and exports.
 * Governing docs:
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/original-source-delivery.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://github.com/rustfs/rustfs
 * - https://github.com/seaweedfs/seaweedfs
 * - https://kopia.io/docs/features/
 * Tests:
 * - packages/storage/test/storage-role-config.test.ts
 */

export const storageRoles = ['ingest', 'source', 'derived', 'exports'] as const;

export type StorageRole = (typeof storageRoles)[number];
export type StorageLayoutMode = 'one-bucket' | 'multi-bucket';

export interface SharedBucketStorageLayout {
  mode: 'one-bucket';
  bucket: string;
  prefixes: Record<StorageRole, string>;
}

export interface SplitBucketStorageLayout {
  mode: 'multi-bucket';
  buckets: Record<StorageRole, string>;
  prefixes?: Partial<Record<StorageRole, string>>;
}

export type StorageLayoutInput = SharedBucketStorageLayout | SplitBucketStorageLayout;

export interface NormalizedStorageRoleTarget {
  role: StorageRole;
  bucket: string;
  prefix: string;
  targetKey: string;
}

export class StorageTopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageTopologyError';
  }
}

function normalizePrefix(prefix: string | undefined): string {
  const trimmed = (prefix ?? '').trim().replace(/^\/+|\/+$/g, '');

  if (trimmed.length === 0) {
    throw new StorageTopologyError('Storage role prefixes must be non-empty after normalization.');
  }

  return trimmed;
}

function normalizeBucket(bucket: string): string {
  const trimmed = bucket.trim();

  if (trimmed.length === 0) {
    throw new StorageTopologyError('Storage role buckets must be non-empty.');
  }

  return trimmed;
}

function normalizeRoleTarget(role: StorageRole, bucket: string, prefix: string): NormalizedStorageRoleTarget {
  const normalizedBucket = normalizeBucket(bucket);
  const normalizedPrefix = normalizePrefix(prefix);

  return {
    role,
    bucket: normalizedBucket,
    prefix: normalizedPrefix,
    targetKey: `${normalizedBucket}/${normalizedPrefix}`
  };
}

export function normalizeStorageLayout(input: StorageLayoutInput): Record<StorageRole, NormalizedStorageRoleTarget> {
  const normalized = Object.fromEntries(
    storageRoles.map((role) => {
      if (input.mode === 'one-bucket') {
        return [role, normalizeRoleTarget(role, input.bucket, input.prefixes[role])];
      }

      return [role, normalizeRoleTarget(role, input.buckets[role], input.prefixes?.[role] ?? role)];
    })
  ) as Record<StorageRole, NormalizedStorageRoleTarget>;

  const seenTargets = new Map<string, StorageRole>();

  for (const role of storageRoles) {
    const target = normalized[role];
    const priorRole = seenTargets.get(target.targetKey);

    if (priorRole) {
      throw new StorageTopologyError(
        `Storage roles "${priorRole}" and "${role}" resolve to the same target "${target.targetKey}".`
      );
    }

    seenTargets.set(target.targetKey, role);
  }

  return normalized;
}

export function resolvePublicationTarget(
  layout: StorageLayoutInput,
  publicationKind: 'derivative' | 'source-export'
): NormalizedStorageRoleTarget {
  const normalized = normalizeStorageLayout(layout);

  return publicationKind === 'derivative' ? normalized.derived : normalized.exports;
}
