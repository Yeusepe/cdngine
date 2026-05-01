/**
 * Purpose: Builds the deterministic manifest shape for generic preserve-original publication.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/workflow-extensibility.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://semver.org/
 * Tests:
 * - packages/manifests/test/generic-asset-manifest.test.mjs
 */

export interface GenericAssetManifestDerivative {
  byteLength: bigint;
  checksum: string;
  contentType: string;
  deterministicKey: string;
  recipeId: string;
  schemaVersion: string;
  variantKey: string;
}

export interface BuildGenericAssetManifestInput {
  assetId: string;
  generatedAt: Date;
  manifestType: 'generic-asset-default';
  preservedOriginal: GenericAssetManifestDerivative;
  schemaVersion: 'v1';
  serviceNamespaceId: string;
  versionId: string;
}

export interface GenericAssetManifest {
  assetId: string;
  generatedAt: string;
  manifestType: 'generic-asset-default';
  preservedOriginal: {
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
  versionId: string;
}

function normalizeDerivative(input: GenericAssetManifestDerivative) {
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

export function buildGenericAssetManifest(
  input: BuildGenericAssetManifestInput
): GenericAssetManifest {
  return {
    assetId: input.assetId,
    generatedAt: input.generatedAt.toISOString(),
    manifestType: input.manifestType,
    preservedOriginal: normalizeDerivative(input.preservedOriginal),
    schemaVersion: input.schemaVersion,
    serviceNamespaceId: input.serviceNamespaceId,
    versionId: input.versionId
  };
}
