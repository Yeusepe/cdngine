/**
 * Purpose: Normalizes engine-neutral canonical-source evidence into the registry persistence shape and reconstructs snapshot results from that durable evidence.
 * Governing docs:
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/source-plane-strategy.md
 * - docs/persistence-model.md
 * - docs/domain-model.md
 * External references:
 * - https://kopia.io/docs/features/
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://restic.readthedocs.io/en/stable/design.html
 * Tests:
 * - packages/storage/test/canonical-source-evidence.test.ts
 */

import type {
  ObjectChecksum,
  SnapshotResult,
  SourceDedupeMetrics,
  SourceReconstructionHandle,
  SourceRepositoryEngine
} from './adapter-contracts.js';

export interface PersistedCanonicalSourceEvidence {
  repositoryEngine: SourceRepositoryEngine;
  canonicalSourceId: string;
  canonicalSnapshotId: string;
  canonicalLogicalPath: string;
  canonicalDigestSet: ObjectChecksum[];
  canonicalLogicalByteLength?: bigint;
  canonicalStoredByteLength?: bigint;
  dedupeMetrics?: SourceDedupeMetrics;
  sourceReconstructionHandles?: SourceReconstructionHandle[];
  sourceSubstrateHints?: Record<string, string>;
}

function cloneDigestSet(digests: ObjectChecksum[]) {
  return digests.map((digest) => ({ ...digest }));
}

function cloneDedupeMetrics(
  dedupeMetrics: SourceDedupeMetrics | undefined
): SourceDedupeMetrics | undefined {
  if (!dedupeMetrics) {
    return undefined;
  }

  return {
    ...dedupeMetrics,
    ...(dedupeMetrics.storedByteLength === undefined
      ? {}
      : { storedByteLength: dedupeMetrics.storedByteLength })
  };
}

function cloneReconstructionHandles(
  reconstructionHandles: SourceReconstructionHandle[] | undefined
): SourceReconstructionHandle[] | undefined {
  return reconstructionHandles?.map((handle) => ({
    kind: handle.kind,
    value: handle.value
  }));
}

export function clonePersistedCanonicalSourceEvidence(
  evidence: PersistedCanonicalSourceEvidence
): PersistedCanonicalSourceEvidence {
  const result: PersistedCanonicalSourceEvidence = {
    repositoryEngine: evidence.repositoryEngine,
    canonicalSourceId: evidence.canonicalSourceId,
    canonicalSnapshotId: evidence.canonicalSnapshotId,
    canonicalLogicalPath: evidence.canonicalLogicalPath,
    canonicalDigestSet: cloneDigestSet(evidence.canonicalDigestSet),
    ...(evidence.canonicalLogicalByteLength === undefined
      ? {}
      : { canonicalLogicalByteLength: evidence.canonicalLogicalByteLength }),
    ...(evidence.canonicalStoredByteLength === undefined
      ? {}
      : { canonicalStoredByteLength: evidence.canonicalStoredByteLength }),
  };

  if (evidence.dedupeMetrics) {
    result.dedupeMetrics = cloneDedupeMetrics(evidence.dedupeMetrics) as SourceDedupeMetrics;
  }

  if (evidence.sourceReconstructionHandles) {
    result.sourceReconstructionHandles = cloneReconstructionHandles(
      evidence.sourceReconstructionHandles
    ) as SourceReconstructionHandle[];
  }

  if (evidence.sourceSubstrateHints) {
    result.sourceSubstrateHints = { ...evidence.sourceSubstrateHints };
  }

  return result;
}

export function snapshotResultToCanonicalSourceEvidence(
  snapshot: SnapshotResult
): PersistedCanonicalSourceEvidence {
  const result: PersistedCanonicalSourceEvidence = {
    repositoryEngine: snapshot.repositoryEngine,
    canonicalSourceId: snapshot.canonicalSourceId,
    canonicalSnapshotId: snapshot.snapshotId,
    canonicalLogicalPath: snapshot.logicalPath,
    canonicalDigestSet: cloneDigestSet(snapshot.digests),
    ...(snapshot.logicalByteLength === undefined
      ? {}
      : { canonicalLogicalByteLength: snapshot.logicalByteLength }),
    ...(snapshot.storedByteLength === undefined
      ? {}
      : { canonicalStoredByteLength: snapshot.storedByteLength }),
  };

  if (snapshot.dedupeMetrics) {
    result.dedupeMetrics = cloneDedupeMetrics(snapshot.dedupeMetrics) as SourceDedupeMetrics;
  }

  if (snapshot.reconstructionHandles) {
    result.sourceReconstructionHandles = cloneReconstructionHandles(
      snapshot.reconstructionHandles
    ) as SourceReconstructionHandle[];
  }

  if (snapshot.substrateHints) {
    result.sourceSubstrateHints = { ...snapshot.substrateHints };
  }

  return result;
}

export function canonicalSourceEvidenceToSnapshotResult(
  evidence: PersistedCanonicalSourceEvidence
): SnapshotResult {
  const result: SnapshotResult = {
    repositoryEngine: evidence.repositoryEngine,
    canonicalSourceId: evidence.canonicalSourceId,
    snapshotId: evidence.canonicalSnapshotId,
    logicalPath: evidence.canonicalLogicalPath,
    digests: cloneDigestSet(evidence.canonicalDigestSet),
    ...(evidence.canonicalLogicalByteLength === undefined
      ? {}
      : { logicalByteLength: evidence.canonicalLogicalByteLength }),
    ...(evidence.canonicalStoredByteLength === undefined
      ? {}
      : { storedByteLength: evidence.canonicalStoredByteLength }),
  };

  if (evidence.dedupeMetrics) {
    result.dedupeMetrics = cloneDedupeMetrics(evidence.dedupeMetrics) as SourceDedupeMetrics;
  }

  if (evidence.sourceReconstructionHandles) {
    result.reconstructionHandles = cloneReconstructionHandles(
      evidence.sourceReconstructionHandles
    ) as SourceReconstructionHandle[];
  }

  if (evidence.sourceSubstrateHints) {
    result.substrateHints = { ...evidence.sourceSubstrateHints };
  }

  return result;
}
