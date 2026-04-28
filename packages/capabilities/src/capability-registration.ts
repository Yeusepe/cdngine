/**
 * Purpose: Defines shared capability and processor registration contracts used by workload-specific capability modules.
 * Governing docs:
 * - docs/pipeline-capability-model.md
 * - docs/service-registration-model.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * Tests:
 * - packages/capabilities/test/image-capability.test.mjs
 * - packages/capabilities/test/presentation-capability.test.mjs
 */

import type {
  CapabilityMatchStrategy,
  CapabilityNormalizationRegistration
} from './normalization-contract.js';

export interface CapabilityRegistration {
  capabilityId: string;
  extensions: readonly string[];
  keyTemplate: string;
  matchStrategy: CapabilityMatchStrategy;
  mimeTypes: readonly string[];
  normalization: CapabilityNormalizationRegistration;
  recipes: readonly string[];
  resourceProfile: string;
  retryPolicy: string;
  schemaVersion: string;
  validators: readonly string[];
}

export interface ProcessorRegistration {
  capabilities: readonly string[];
  observabilityLabels: Readonly<Record<string, string>>;
  processorId: string;
  recipes: readonly string[];
  retryPolicy: string;
  runtimeProfile: string;
  timeoutPolicy: string;
}
