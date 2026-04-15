/**
 * Purpose: Orchestrates presentation normalization from canonical source identity to deterministic normalized-document, slide-image, and manifest publication.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/pipeline-capability-model.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/adr/0003-deterministic-derivative-keys.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://github.com/gotenberg/gotenberg
 * Tests:
 * - packages/workflows/test/presentation-publication-workflow.test.mjs
 */

import { createHash } from 'node:crypto';

import {
  defaultPresentationRecipeBindings,
  getPresentationRecipeBinding,
  type PresentationRecipeBinding
} from '@cdngine/capabilities';
import {
  buildDeterministicDerivativeKey,
  buildManifestObjectKey,
  buildPresentationAssetManifest
} from '@cdngine/manifests';
import type {
  CanonicalPresentationVersionRecord,
  PresentationPublicationStore,
  PublishedPresentationDerivativeRecord,
  PublishedPresentationManifestRecord
} from '@cdngine/registry';
import type { DerivedObjectStore, ObjectChecksum } from '@cdngine/storage';

export interface PresentationDerivativeOutput {
  body: Uint8Array | string;
  byteLength: bigint;
  checksum?: ObjectChecksum;
  contentType: string;
}

export interface PresentationSlideOutput extends PresentationDerivativeOutput {
  pageNumber: number;
}

export interface PresentationProcessingActivityInput {
  canonicalSourceId: string;
  normalizedDocumentRecipeBinding: PresentationRecipeBinding;
  slideImageRecipeBinding: PresentationRecipeBinding;
  sourceContentType: string;
  sourceFilename: string;
}

export interface PresentationProcessingActivityResult {
  normalizedDocument: PresentationDerivativeOutput;
  slides: PresentationSlideOutput[];
}

export interface PresentationProcessingActivity {
  processPresentation(input: PresentationProcessingActivityInput): Promise<PresentationProcessingActivityResult>;
}

export interface RunPresentationPublicationWorkflowInput {
  deliveryScopeId: string;
  versionId: string;
  workflowId: string;
}

export interface PresentationPublicationWorkflowDependencies {
  derivedObjectStore: DerivedObjectStore;
  now?: () => Date;
  processorActivity: PresentationProcessingActivity;
  publicationStore: PresentationPublicationStore;
  recipeBindings?: readonly PresentationRecipeBinding[];
}

export interface PresentationPublicationWorkflowResult {
  derivatives: PublishedPresentationDerivativeRecord[];
  manifest: PublishedPresentationManifestRecord;
  version: CanonicalPresentationVersionRecord;
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

function deriveSlideVariantKey(pageNumber: number): string {
  return `slide-${String(pageNumber).padStart(3, '0')}`;
}

export async function runPresentationPublicationWorkflow(
  input: RunPresentationPublicationWorkflowInput,
  dependencies: PresentationPublicationWorkflowDependencies
): Promise<PresentationPublicationWorkflowResult> {
  const now = dependencies.now ?? (() => new Date());
  const version = await dependencies.publicationStore.beginPresentationPublication({
    startedAt: now(),
    versionId: input.versionId,
    workflowId: input.workflowId
  });
  const recipeBindings = dependencies.recipeBindings ?? defaultPresentationRecipeBindings;
  const normalizedDocumentRecipeBinding =
    recipeBindings.find((binding) => binding.recipeId === 'normalized-pdf') ??
    getPresentationRecipeBinding('normalized-pdf');
  const slideImageRecipeBinding =
    recipeBindings.find((binding) => binding.recipeId === 'slide-images') ??
    getPresentationRecipeBinding('slide-images');
  const processed = await dependencies.processorActivity.processPresentation({
    canonicalSourceId: version.canonicalSourceId,
    normalizedDocumentRecipeBinding,
    slideImageRecipeBinding,
    sourceContentType: version.detectedContentType,
    sourceFilename: version.sourceFilename
  });

  const derivatives: PublishedPresentationDerivativeRecord[] = [];
  const normalizedIntegrity = processed.normalizedDocument.checksum
    ? {
        byteLength: processed.normalizedDocument.byteLength,
        checksum: processed.normalizedDocument.checksum
      }
    : hashBody(processed.normalizedDocument.body);
  const normalizedDeterministicKey = buildDeterministicDerivativeKey({
    assetId: version.assetId,
    recipeId: normalizedDocumentRecipeBinding.recipeId,
    serviceNamespaceId: version.serviceNamespaceId,
    variantKey: 'normalized-pdf',
    versionId: version.versionId
  });
  const normalizedPublication = await dependencies.derivedObjectStore.publishObject({
    body: processed.normalizedDocument.body,
    byteLength: normalizedIntegrity.byteLength,
    checksum: normalizedIntegrity.checksum,
    contentType: processed.normalizedDocument.contentType,
    objectKey: normalizedDeterministicKey
  });

  const normalizedDerivative: PublishedPresentationDerivativeRecord = {
    assetVersionId: version.versionId,
    byteLength: normalizedIntegrity.byteLength,
    checksumValue: normalizedIntegrity.checksum.value,
    contentType: processed.normalizedDocument.contentType,
    deliveryScopeId: input.deliveryScopeId,
    deterministicKey: normalizedDeterministicKey,
    publicationState: 'published',
    publishedAt: now(),
    recipeId: normalizedDocumentRecipeBinding.recipeId,
    schemaVersion: normalizedDocumentRecipeBinding.schemaVersion,
    storageBucket: normalizedPublication.bucket,
    storageKey: normalizedPublication.key,
    variantKey: 'normalized-pdf'
  };
  derivatives.push(normalizedDerivative);

  for (const slide of [...processed.slides].sort((left, right) => left.pageNumber - right.pageNumber)) {
    const slideIntegrity = slide.checksum
      ? { byteLength: slide.byteLength, checksum: slide.checksum }
      : hashBody(slide.body);
    const variantKey = deriveSlideVariantKey(slide.pageNumber);
    const deterministicKey = buildDeterministicDerivativeKey({
      assetId: version.assetId,
      recipeId: slideImageRecipeBinding.recipeId,
      serviceNamespaceId: version.serviceNamespaceId,
      variantKey,
      versionId: version.versionId
    });
    const publication = await dependencies.derivedObjectStore.publishObject({
      body: slide.body,
      byteLength: slideIntegrity.byteLength,
      checksum: slideIntegrity.checksum,
      contentType: slide.contentType,
      objectKey: deterministicKey
    });

    derivatives.push({
      assetVersionId: version.versionId,
      byteLength: slideIntegrity.byteLength,
      checksumValue: slideIntegrity.checksum.value,
      contentType: slide.contentType,
      deliveryScopeId: input.deliveryScopeId,
      deterministicKey,
      pageNumber: slide.pageNumber,
      publicationState: 'published',
      publishedAt: now(),
      recipeId: slideImageRecipeBinding.recipeId,
      schemaVersion: slideImageRecipeBinding.schemaVersion,
      storageBucket: publication.bucket,
      storageKey: publication.key,
      variantKey
    });
  }

  const manifestPayload = buildPresentationAssetManifest({
    assetId: version.assetId,
    generatedAt: now(),
    manifestType: 'presentation-default',
    normalizedDocument: {
      byteLength: normalizedDerivative.byteLength,
      checksum: normalizedDerivative.checksumValue,
      contentType: normalizedDerivative.contentType,
      deterministicKey: normalizedDerivative.deterministicKey,
      recipeId: normalizedDerivative.recipeId,
      schemaVersion: normalizedDerivative.schemaVersion,
      variantKey: normalizedDerivative.variantKey
    },
    schemaVersion: 'v1',
    serviceNamespaceId: version.serviceNamespaceId,
    slides: derivatives
      .filter((derivative) => derivative.recipeId === 'slide-images')
      .map((derivative) => ({
        byteLength: derivative.byteLength,
        checksum: derivative.checksumValue,
        contentType: derivative.contentType,
        deterministicKey: derivative.deterministicKey,
        pageNumber: derivative.pageNumber ?? 0,
        recipeId: derivative.recipeId,
        schemaVersion: derivative.schemaVersion,
        variantKey: derivative.variantKey
      })),
    versionId: version.versionId
  });
  const manifestBody = JSON.stringify(manifestPayload, null, 2);
  const manifestPayloadRecord: Record<string, unknown> = JSON.parse(manifestBody);
  const manifestIntegrity = hashBody(manifestBody);
  const manifestObjectKey = buildManifestObjectKey({
    assetId: version.assetId,
    manifestType: 'presentation-default',
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
  const manifest: PublishedPresentationManifestRecord = {
    assetVersionId: version.versionId,
    checksumValue: manifestIntegrity.checksum.value,
    deliveryScopeId: input.deliveryScopeId,
    manifestPayload: manifestPayloadRecord,
    manifestType: 'presentation-default',
    objectKey: manifestPublication.key,
    publicationState: 'published',
    publishedAt: now(),
    schemaVersion: 'v1'
  };
  const publishedVersion = await dependencies.publicationStore.publishPresentationVersion({
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
