/**
 * Purpose: Builds the deterministic manifest shape for the first image publication workflow.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/versioning-and-compatibility.md
 * - docs/adr/0003-deterministic-derivative-keys.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://semver.org/
 * Tests:
 * - packages/manifests/test/image-manifest.test.mjs
 */

export interface ImageManifestDerivative {
  byteLength: bigint;
  checksum: string;
  contentType: string;
  deterministicKey: string;
  recipeId: string;
  schemaVersion: string;
  variantKey: string;
}

export interface BuildImageManifestInput {
  assetId: string;
  derivatives: ImageManifestDerivative[];
  generatedAt: Date;
  manifestType: 'image-default';
  schemaVersion: 'v1';
  serviceNamespaceId: string;
  versionId: string;
}

export interface ImageAssetManifest {
  assetId: string;
  derivatives: {
    byteLength: number;
    checksum: string;
    contentType: string;
    deterministicKey: string;
    recipeId: string;
    schemaVersion: string;
    variantKey: string;
  }[];
  generatedAt: string;
  manifestType: 'image-default';
  schemaVersion: 'v1';
  serviceNamespaceId: string;
  versionId: string;
}

export function buildImageAssetManifest(input: BuildImageManifestInput): ImageAssetManifest {
  const derivatives = [...input.derivatives]
    .sort((left, right) => left.deterministicKey.localeCompare(right.deterministicKey))
    .map((derivative) => ({
      byteLength: Number(derivative.byteLength),
      checksum: derivative.checksum,
      contentType: derivative.contentType,
      deterministicKey: derivative.deterministicKey,
      recipeId: derivative.recipeId,
      schemaVersion: derivative.schemaVersion,
      variantKey: derivative.variantKey
    }));

  return {
    assetId: input.assetId,
    derivatives,
    generatedAt: input.generatedAt.toISOString(),
    manifestType: input.manifestType,
    schemaVersion: input.schemaVersion,
    serviceNamespaceId: input.serviceNamespaceId,
    versionId: input.versionId
  };
}
