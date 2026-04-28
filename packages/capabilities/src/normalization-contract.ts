/**
 * Purpose: Defines the format-agnostic normalization contract that capability registrations use to declare safe fallback evidence, optional container inventory, and capability-owned semantic extractors.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/workflow-extensibility.md
 * - docs/workload-and-recipe-matrix.md
 * - docs/canonical-source-and-tiering-contract.md
 * External references:
 * - https://www.libarchive.org/
 * - https://reproducible-builds.org/docs/archives/
 * - https://openassetio.github.io/OpenAssetIO/
 * Tests:
 * - packages/capabilities/test/presentation-capability.test.mjs
 */

export type CapabilityMatchStrategy = 'exact' | 'fallback';

export type NormalizationDigestAlgorithm = 'sha256';

export type NormalizationExecutionMode = 'none' | 'post-canonicalization';

export type SemanticClaimsMode = 'none' | 'capability-scoped';

export type ContainerInventoryMode = 'never' | 'when-container-detected' | 'always';

export type NormalizationArtifactType =
  | 'container-inventory'
  | 'canonical-intermediate'
  | 'semantic-fingerprint'
  | 'semantic-relations';

export interface ContainerInventoryFallbackPolicy {
  evidenceType: 'generic-container-inventory';
  mode: ContainerInventoryMode;
}

export interface CapabilityFallbackPolicy {
  preserveOriginal: true;
  digestAlgorithms: readonly NormalizationDigestAlgorithm[];
  semanticClaims: SemanticClaimsMode;
  containerInventory?: ContainerInventoryFallbackPolicy;
}

export interface ContainerNormalizerRegistration {
  normalizerId: string;
  inventorySchemaVersion: string;
  supportedExtensions: readonly string[];
  supportedMimeTypes: readonly string[];
}

export interface SemanticExtractorRegistration {
  extractorId: string;
  factSchemaVersion: string;
  supportedExtensions: readonly string[];
  supportedMimeTypes: readonly string[];
}

export interface CanonicalIntermediateBuilderRegistration {
  builderId: string;
  artifactType: string;
  schemaVersion: string;
}

export interface SemanticFingerprintBuilderRegistration {
  fingerprintId: string;
  schemaVersion: string;
  subject: string;
}

export interface SemanticRelationRecorderRegistration {
  recorderId: string;
  relationSchemaVersion: string;
}

export interface CapabilityNormalizationRegistration {
  executionMode: NormalizationExecutionMode;
  fallback: CapabilityFallbackPolicy;
  supportedArtifacts: readonly NormalizationArtifactType[];
  containerNormalizers?: readonly ContainerNormalizerRegistration[];
  semanticExtractors?: readonly SemanticExtractorRegistration[];
  intermediateBuilders?: readonly CanonicalIntermediateBuilderRegistration[];
  fingerprintBuilders?: readonly SemanticFingerprintBuilderRegistration[];
  relationRecorders?: readonly SemanticRelationRecorderRegistration[];
}

export interface FormatAgnosticNormalizationOptions {
  containerInventoryMode?: Exclude<ContainerInventoryMode, 'never'>;
  semanticClaims?: SemanticClaimsMode;
  supportedArtifacts?: readonly NormalizationArtifactType[];
}

export function createFormatAgnosticNormalizationRegistration(
  options: FormatAgnosticNormalizationOptions = {}
): CapabilityNormalizationRegistration {
  return {
    executionMode: 'post-canonicalization',
    supportedArtifacts: options.supportedArtifacts ?? [],
    fallback: {
      preserveOriginal: true,
      digestAlgorithms: ['sha256'],
      semanticClaims: options.semanticClaims ?? 'none',
      ...(options.containerInventoryMode
        ? {
            containerInventory: {
              evidenceType: 'generic-container-inventory',
              mode: options.containerInventoryMode
            }
          }
        : {})
    }
  };
}
