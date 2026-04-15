/**
 * Purpose: Builds the deterministic manifest shape for presentation normalization, including the normalized document plus page-ordered slide outputs.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/versioning-and-compatibility.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://semver.org/
 * Tests:
 * - packages/manifests/test/presentation-manifest.test.mjs
 */

export interface PresentationManifestDerivative {
  byteLength: bigint;
  checksum: string;
  contentType: string;
  deterministicKey: string;
  recipeId: string;
  schemaVersion: string;
  variantKey: string;
}

export interface PresentationManifestSlide extends PresentationManifestDerivative {
  pageNumber: number;
}

export interface BuildPresentationManifestInput {
  assetId: string;
  generatedAt: Date;
  manifestType: 'presentation-default';
  normalizedDocument: PresentationManifestDerivative;
  schemaVersion: 'v1';
  serviceNamespaceId: string;
  slides: PresentationManifestSlide[];
  versionId: string;
}

export interface PresentationAssetManifest {
  assetId: string;
  generatedAt: string;
  manifestType: 'presentation-default';
  normalizedDocument: {
    byteLength: number;
    checksum: string;
    contentType: string;
    deterministicKey: string;
    recipeId: string;
    schemaVersion: string;
    variantKey: string;
  };
  schemaVersion: 'v1';
  serviceNamespaceId: string;
  slides: {
    byteLength: number;
    checksum: string;
    contentType: string;
    deterministicKey: string;
    pageNumber: number;
    recipeId: string;
    schemaVersion: string;
    variantKey: string;
  }[];
  versionId: string;
}

function normalizeDerivative(input: PresentationManifestDerivative) {
  return {
    byteLength: Number(input.byteLength),
    checksum: input.checksum,
    contentType: input.contentType,
    deterministicKey: input.deterministicKey,
    recipeId: input.recipeId,
    schemaVersion: input.schemaVersion,
    variantKey: input.variantKey
  };
}

export function buildPresentationAssetManifest(
  input: BuildPresentationManifestInput
): PresentationAssetManifest {
  const slides = [...input.slides]
    .sort((left, right) => left.pageNumber - right.pageNumber || left.deterministicKey.localeCompare(right.deterministicKey))
    .map((slide) => ({
      ...normalizeDerivative(slide),
      pageNumber: slide.pageNumber
    }));

  return {
    assetId: input.assetId,
    generatedAt: input.generatedAt.toISOString(),
    manifestType: input.manifestType,
    normalizedDocument: normalizeDerivative(input.normalizedDocument),
    schemaVersion: input.schemaVersion,
    serviceNamespaceId: input.serviceNamespaceId,
    slides,
    versionId: input.versionId
  };
}
