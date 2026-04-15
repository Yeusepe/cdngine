/**
 * Purpose: Builds stable derivative and manifest object keys for replay-safe publication.
 * Governing docs:
 * - docs/adr/0003-deterministic-derivative-keys.md
 * - docs/domain-model.md
 * - docs/versioning-and-compatibility.md
 * External references:
 * - https://semver.org/
 * Tests:
 * - packages/manifests/test/image-manifest.test.mjs
 */

export interface DeterministicDerivativeKeyInput {
  assetId: string;
  recipeId: string;
  serviceNamespaceId: string;
  variantKey: string;
  versionId: string;
}

export interface ManifestObjectKeyInput {
  assetId: string;
  manifestType: string;
  serviceNamespaceId: string;
  versionId: string;
}

export function buildDeterministicDerivativeKey(input: DeterministicDerivativeKeyInput): string {
  return `deriv/${input.serviceNamespaceId}/${input.assetId}/${input.versionId}/${input.recipeId}/${input.variantKey}`;
}

export function buildManifestObjectKey(input: ManifestObjectKeyInput): string {
  return `manifests/${input.serviceNamespaceId}/${input.assetId}/${input.versionId}/${input.manifestType}.json`;
}

export function buildImageManifestObjectKey(input: ManifestObjectKeyInput): string {
  return buildManifestObjectKey(input);
}
