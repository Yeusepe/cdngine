/**
 * Purpose: Restores engine-neutral canonical-source evidence to a concrete file path so workers, exports, and operator replay can share one dual-read materialization helper.
 * Governing docs:
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/source-plane-strategy.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/original-source-delivery.md
 * External references:
 * - https://kopia.io/docs/features/
 * - https://huggingface.co/docs/xet/en/deduplication
 * Tests:
 * - apps/api/test/delivery-routes.test.mjs
 * - apps/api/test/operator-routes.test.mjs
 * - apps/workers/test/source-materialization.test.mjs
 */

import type { SnapshotResult, SourceRepository } from './adapter-contracts.js';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  canonicalSourceEvidenceToSnapshotResult,
  type PersistedCanonicalSourceEvidence
} from './canonical-source-evidence.js';

export interface MaterializeCanonicalSourceToPathInput {
  canonicalSource: PersistedCanonicalSourceEvidence | SnapshotResult;
  destinationPath: string;
}

function isPersistedCanonicalSourceEvidence(
  canonicalSource: PersistedCanonicalSourceEvidence | SnapshotResult
): canonicalSource is PersistedCanonicalSourceEvidence {
  return 'canonicalSnapshotId' in canonicalSource;
}

const invalidMaterializedFilenameCharacterPattern = /[\u0000-\u001f<>:"|?*]/g;

function takeLastPathSegment(candidate: string) {
  const normalizedSeparators = candidate.replace(/\\/g, '/');
  const segments = normalizedSeparators.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? '';
}

function sanitizeMaterializedFilename(candidate: string) {
  return takeLastPathSegment(candidate.trim())
    .replace(invalidMaterializedFilenameCharacterPattern, '-')
    .replace(/[. ]+$/g, '');
}

function isUnsafeMaterializedFilename(filename: string) {
  return filename.length === 0 || filename === '.' || filename === '..';
}

export function isSafeSourceFilename(filename: string) {
  const trimmed = filename.trim();

  if (trimmed.length === 0) {
    return false;
  }

  const sanitized = sanitizeMaterializedFilename(trimmed);
  return !isUnsafeMaterializedFilename(sanitized) && sanitized === trimmed;
}

export function resolveMaterializedSourceFilename(input: {
  sourceFilename?: string;
  canonicalLogicalPath?: string;
  fallbackBaseName?: string;
}) {
  const fallbackBaseName = input.fallbackBaseName?.trim() || 'source.bin';

  for (const candidate of [
    input.sourceFilename,
    input.canonicalLogicalPath,
    fallbackBaseName
  ]) {
    if (!candidate) {
      continue;
    }

    const sanitized = sanitizeMaterializedFilename(candidate);

    if (!isUnsafeMaterializedFilename(sanitized)) {
      return sanitized;
    }
  }

  return 'source.bin';
}

export function buildMaterializedSourcePath(input: {
  rootPath: string;
  pathSegments: string[];
  sourceFilename?: string;
  canonicalLogicalPath?: string;
  fallbackBaseName?: string;
}) {
  const resolvedRootPath = resolve(input.rootPath);
  const destinationPath = resolve(
    resolvedRootPath,
    ...input.pathSegments,
    resolveMaterializedSourceFilename(input)
  );
  const relativeDestinationPath = relative(resolvedRootPath, destinationPath);

  if (
    relativeDestinationPath.length === 0 ||
    relativeDestinationPath === '..' ||
    relativeDestinationPath.startsWith(`..\\`) ||
    relativeDestinationPath.startsWith('../') ||
    isAbsolute(relativeDestinationPath)
  ) {
    throw new Error('Materialized source destination must stay within the configured root.');
  }

  return destinationPath;
}

export async function materializeCanonicalSourceToPath(
  sourceRepository: SourceRepository,
  input: MaterializeCanonicalSourceToPathInput
) {
  const snapshot = isPersistedCanonicalSourceEvidence(input.canonicalSource)
    ? canonicalSourceEvidenceToSnapshotResult(input.canonicalSource)
    : input.canonicalSource;

  return sourceRepository.restoreToPath({
    canonicalSourceId: snapshot.canonicalSourceId,
    destinationPath: input.destinationPath,
    snapshot
  });
}
