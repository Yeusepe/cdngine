/**
 * Purpose: Orchestrates the first image-focused publication workflow from canonical source identity to deterministic derivative and manifest publication.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/pipeline-capability-model.md
 * - docs/domain-model.md
 * - docs/adr/0003-deterministic-derivative-keys.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://github.com/imgproxy/imgproxy
 * - https://github.com/libvips/libvips
 * Tests:
 * - packages/workflows/test/image-publication-workflow.test.mjs
 */

import { createHash } from 'node:crypto';

import {
  defaultImageRecipeBindings,
  type ImageRecipeBinding
} from '@cdngine/capabilities';
import {
  buildDeterministicDerivativeKey,
  buildImageAssetManifest,
  buildImageManifestObjectKey
} from '@cdngine/manifests';
import type {
  CanonicalImageVersionRecord,
  ImagePublicationStore,
  PublishedDerivativeRecord,
  PublishedManifestRecord
} from '@cdngine/registry';
import type { DerivedObjectStore, ObjectChecksum } from '@cdngine/storage';

export interface ImageDerivativeActivityInput {
  canonicalSourceId: string;
  recipeBinding: ImageRecipeBinding;
  sourceContentType: string;
  sourceFilename: string;
}

export interface ImageDerivativeActivityResult {
  body: Uint8Array | string;
  byteLength: bigint;
  checksum?: ObjectChecksum;
  contentType: string;
  metadata?: Record<string, unknown>;
}

export interface ImageDerivativeActivity {
  processDerivative(input: ImageDerivativeActivityInput): Promise<ImageDerivativeActivityResult>;
}

export interface RunImagePublicationWorkflowInput {
  deliveryScopeId: string;
  versionId: string;
  workflowId: string;
}

export interface ImagePublicationWorkflowDependencies {
  derivedObjectStore: DerivedObjectStore;
  processorActivity: ImageDerivativeActivity;
  publicationStore: ImagePublicationStore;
  recipeBindings?: readonly ImageRecipeBinding[];
  now?: () => Date;
}

export interface ImagePublicationWorkflowResult {
  derivatives: PublishedDerivativeRecord[];
  manifest: PublishedManifestRecord;
  version: CanonicalImageVersionRecord;
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

export async function runImagePublicationWorkflow(
  input: RunImagePublicationWorkflowInput,
  dependencies: ImagePublicationWorkflowDependencies
): Promise<ImagePublicationWorkflowResult> {
  const now = dependencies.now ?? (() => new Date());
  const version = await dependencies.publicationStore.beginImagePublication({
    startedAt: now(),
    versionId: input.versionId,
    workflowId: input.workflowId
  });
  const recipeBindings = dependencies.recipeBindings ?? defaultImageRecipeBindings;
  const derivatives: PublishedDerivativeRecord[] = [];

  for (const recipeBinding of recipeBindings) {
    const processed = await dependencies.processorActivity.processDerivative({
      canonicalSourceId: version.canonicalSourceId,
      recipeBinding,
      sourceContentType: version.detectedContentType,
      sourceFilename: version.sourceFilename
    });
    const integrity = processed.checksum
      ? { byteLength: processed.byteLength, checksum: processed.checksum }
      : hashBody(processed.body);
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

    derivatives.push({
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
    });
  }

  const manifestPayload = buildImageAssetManifest({
    assetId: version.assetId,
    derivatives: derivatives.map((derivative) => ({
      byteLength: derivative.byteLength,
      checksum: derivative.checksumValue,
      contentType: derivative.contentType,
      deterministicKey: derivative.deterministicKey,
      recipeId: derivative.recipeId,
      schemaVersion: derivative.schemaVersion,
      variantKey: derivative.variantKey
    })),
    generatedAt: now(),
    manifestType: 'image-default',
    schemaVersion: 'v1',
    serviceNamespaceId: version.serviceNamespaceId,
    versionId: version.versionId
  });
  const manifestBody = JSON.stringify(manifestPayload, null, 2);
  const manifestPayloadRecord: Record<string, unknown> = JSON.parse(manifestBody);
  const manifestIntegrity = hashBody(manifestBody);
  const manifestObjectKey = buildImageManifestObjectKey({
    assetId: version.assetId,
    manifestType: 'image-default',
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
  const manifest: PublishedManifestRecord = {
    assetVersionId: version.versionId,
    checksumValue: manifestIntegrity.checksum.value,
    deliveryScopeId: input.deliveryScopeId,
    manifestPayload: manifestPayloadRecord,
    manifestType: 'image-default',
    objectKey: manifestPublication.key,
    publicationState: 'published',
    publishedAt: now(),
    schemaVersion: 'v1'
  };
  const publishedVersion = await dependencies.publicationStore.publishImageVersion({
    deliveryScopeId: input.deliveryScopeId,
    derivatives,
    manifest,
    publishedAt: now(),
    versionId: input.versionId,
    workflowId: input.workflowId
  });

  return {
    derivatives,
    manifest,
    version: publishedVersion
  };
}
