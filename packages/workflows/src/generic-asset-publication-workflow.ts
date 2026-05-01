/**
 * Purpose: Orchestrates generic preserve-original publication from canonical source evidence to deterministic derivative and manifest publication.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/pipeline-capability-model.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/adr/0003-deterministic-derivative-keys.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://reproducible-builds.org/docs/archives/
 * Tests:
 * - packages/workflows/test/generic-asset-publication-workflow.test.mjs
 */

import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  defaultGenericRecipeBindings,
  getGenericRecipeBinding,
  type GenericAssetRecipeBinding
} from '@cdngine/capabilities';
import {
  buildDeterministicDerivativeKey,
  buildGenericAssetManifest,
  buildManifestObjectKey
} from '@cdngine/manifests';
import type {
  CanonicalGenericAssetVersionRecord,
  GenericAssetPublicationStore,
  PublishedGenericAssetDerivativeRecord,
  PublishedGenericAssetManifestRecord
} from '@cdngine/registry';
import type {
  DerivedObjectStore,
  ObjectChecksum
} from '@cdngine/storage';
import type { PersistedCanonicalSourceEvidence } from '@cdngine/storage';

export interface GenericAssetDerivativeActivityInput {
  assetId: string;
  canonicalSourceEvidence: PersistedCanonicalSourceEvidence;
  recipeBinding: GenericAssetRecipeBinding;
  sourceContentType: string;
  sourceFilename: string;
  versionId: string;
}

export interface GenericAssetDerivativeActivityResult {
  body: Uint8Array | string | Readable;
  byteLength: bigint;
  checksum?: ObjectChecksum;
  contentType: string;
  metadata?: Record<string, unknown>;
}

export interface GenericAssetDerivativeActivity {
  processAssetDerivative(
    input: GenericAssetDerivativeActivityInput
  ): Promise<GenericAssetDerivativeActivityResult>;
}

export interface RunGenericAssetPublicationWorkflowInput {
  deliveryScopeId: string;
  versionId: string;
  workflowId: string;
}

export interface GenericAssetPublicationWorkflowDependencies {
  derivedObjectStore: DerivedObjectStore;
  now?: () => Date;
  processorActivity: GenericAssetDerivativeActivity;
  publicationStore: GenericAssetPublicationStore;
  recipeBindings?: readonly GenericAssetRecipeBinding[];
}

export interface GenericAssetPublicationWorkflowResult {
  derivatives: PublishedGenericAssetDerivativeRecord[];
  manifest: PublishedGenericAssetManifestRecord;
  version: CanonicalGenericAssetVersionRecord;
}

function hashBody(body: Uint8Array | string): { byteLength: bigint; checksum: ObjectChecksum } {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);

  return {
    byteLength: BigInt(buffer.byteLength),
    checksum: {
      algorithm: 'sha256',
      value: createHash('sha256').update(buffer).digest('hex')
    }
  };
}

function isReadableBody(value: Uint8Array | string | Readable): value is Readable {
  return typeof value === 'object' && value !== null && 'pipe' in value;
}

function resolveChecksum(
  result: GenericAssetDerivativeActivityResult,
  version: CanonicalGenericAssetVersionRecord
): { byteLength: bigint; checksum: ObjectChecksum } {
  if (result.checksum) {
    return {
      byteLength: result.byteLength,
      checksum: result.checksum
    };
  }

  const canonicalChecksum = version.canonicalSourceEvidence.canonicalDigestSet.find(
    (digest) => digest.algorithm === 'sha256'
  );

  if (canonicalChecksum) {
    return {
      byteLength: result.byteLength,
      checksum: canonicalChecksum
    };
  }

  if (!isReadableBody(result.body)) {
    return hashBody(result.body);
  }

  throw new Error(
    `Generic asset version "${version.versionId}" is missing a stable checksum for preserve-original publication.`
  );
}

export async function runGenericAssetPublicationWorkflow(
  input: RunGenericAssetPublicationWorkflowInput,
  dependencies: GenericAssetPublicationWorkflowDependencies
): Promise<GenericAssetPublicationWorkflowResult> {
  const now = dependencies.now ?? (() => new Date());
  const version = await dependencies.publicationStore.beginGenericAssetPublication({
    startedAt: now(),
    versionId: input.versionId,
    workflowId: input.workflowId
  });
  const recipeBindings = dependencies.recipeBindings ?? defaultGenericRecipeBindings;
  const recipeBinding =
    recipeBindings.find((binding) => binding.recipeId === 'preserve-original') ??
    getGenericRecipeBinding('preserve-original');
  const processed = await dependencies.processorActivity.processAssetDerivative({
    assetId: version.assetId,
    canonicalSourceEvidence: version.canonicalSourceEvidence,
    recipeBinding,
    sourceContentType: version.detectedContentType,
    sourceFilename: version.sourceFilename,
    versionId: version.versionId
  });
  const integrity = resolveChecksum(processed, version);
  const deterministicKey = buildDeterministicDerivativeKey({
    assetId: version.assetId,
    recipeId: recipeBinding.recipeId,
    serviceNamespaceId: version.serviceNamespaceId,
    variantKey: recipeBinding.variantKey,
    versionId: version.versionId
  });
  const publication = await dependencies.derivedObjectStore.publishObject({
    body: processed.body,
    byteLength: integrity.byteLength,
    checksum: integrity.checksum,
    contentType: processed.contentType,
    objectKey: deterministicKey
  });

  const derivative: PublishedGenericAssetDerivativeRecord = {
    assetVersionId: version.versionId,
    byteLength: integrity.byteLength,
    checksumValue: integrity.checksum.value,
    contentType: processed.contentType,
    deliveryScopeId: input.deliveryScopeId,
    deterministicKey,
    ...(processed.metadata ? { metadata: { ...processed.metadata } } : {}),
    publicationState: 'published',
    publishedAt: now(),
    recipeId: recipeBinding.recipeId,
    schemaVersion: recipeBinding.schemaVersion,
    storageBucket: publication.bucket,
    storageKey: publication.key,
    variantKey: recipeBinding.variantKey
  };

  const manifestPayload = buildGenericAssetManifest({
    assetId: version.assetId,
    generatedAt: now(),
    manifestType: recipeBinding.manifestType,
    preservedOriginal: {
      byteLength: derivative.byteLength,
      checksum: derivative.checksumValue,
      contentType: derivative.contentType,
      deterministicKey: derivative.deterministicKey,
      recipeId: derivative.recipeId,
      schemaVersion: derivative.schemaVersion,
      variantKey: derivative.variantKey
    },
    schemaVersion: 'v1',
    serviceNamespaceId: version.serviceNamespaceId,
    versionId: version.versionId
  });
  const manifestBody = JSON.stringify(manifestPayload, null, 2);
  const manifestPayloadRecord: Record<string, unknown> = JSON.parse(manifestBody);
  const manifestIntegrity = hashBody(manifestBody);
  const manifestObjectKey = buildManifestObjectKey({
    assetId: version.assetId,
    manifestType: recipeBinding.manifestType,
    serviceNamespaceId: version.serviceNamespaceId,
    versionId: version.versionId
  });
  const manifestPublication = await dependencies.derivedObjectStore.publishObject({
    body: manifestBody,
    byteLength: manifestIntegrity.byteLength,
    checksum: manifestIntegrity.checksum,
    contentType: 'application/json',
    objectKey: manifestObjectKey
  });
  const manifest: PublishedGenericAssetManifestRecord = {
    assetVersionId: version.versionId,
    checksumValue: manifestIntegrity.checksum.value,
    deliveryScopeId: input.deliveryScopeId,
    manifestPayload: manifestPayloadRecord,
    manifestType: recipeBinding.manifestType,
    objectKey: manifestPublication.key,
    publicationState: 'published',
    publishedAt: now(),
    schemaVersion: 'v1'
  };
  const publishedVersion = await dependencies.publicationStore.publishGenericAssetVersion({
    deliveryScopeId: input.deliveryScopeId,
    derivatives: [derivative],
    manifest,
    publishedAt: now(),
    versionId: input.versionId,
    workflowId: input.workflowId
  });

  return {
    derivatives: [derivative],
    manifest,
    version: publishedVersion
  };
}
