/**
 * Purpose: Loads deployment-time storage topology and delivery defaults from environment variables while preserving the logical storage-role model across one-bucket and multi-bucket profiles.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/original-source-delivery.md
 * External references:
 * - https://docs.docker.com/compose/environment-variables/
 * - https://github.com/rustfs/rustfs
 * - https://github.com/seaweedfs/seaweedfs
 * Tests:
 * - packages/storage/test/runtime-storage-config.test.ts
 */

import {
  normalizeStorageLayout,
  type NormalizedStorageRoleTarget,
  type StorageLayoutInput
} from './storage-role-config.js';

export type SourceDeliveryMode = 'proxy' | 'materialized-export' | 'lazy-read';
export type TieringSubstrate = 'rustfs' | 'seaweedfs';
export type WorkerHotReadLayer = 'none' | 'nydus' | 'alluxio';

export interface StorageRuntimeDefaults {
  hotReadLayer: WorkerHotReadLayer;
  sourceDeliveryMode: SourceDeliveryMode;
  tieringSubstrate: TieringSubstrate;
}

export interface StorageRuntimeConfig {
  defaults: StorageRuntimeDefaults;
  layout: StorageLayoutInput;
  normalized: Record<'ingest' | 'source' | 'derived' | 'exports', NormalizedStorageRoleTarget>;
}

export class StorageRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageRuntimeConfigError';
  }
}

function readEnumValue<TValue extends string>(
  key: string,
  rawValue: string | undefined,
  allowedValues: readonly TValue[],
  fallback: TValue
): TValue {
  const candidate = rawValue?.trim() || fallback;

  if ((allowedValues as readonly string[]).includes(candidate)) {
    return candidate as TValue;
  }

  throw new StorageRuntimeConfigError(
    `${key} must be one of ${allowedValues.join(', ')}. Received "${rawValue}".`
  );
}

function readRequiredValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();

  if (!value) {
    throw new StorageRuntimeConfigError(`${key} is required for the selected storage layout.`);
  }

  return value;
}

function readPrefix(environment: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return environment[key]?.trim() || fallback;
}

export function loadStorageRuntimeConfigFromEnvironment(
  environment: NodeJS.ProcessEnv
): StorageRuntimeConfig {
  const layoutMode = readEnumValue(
    'CDNGINE_STORAGE_LAYOUT_MODE',
    environment.CDNGINE_STORAGE_LAYOUT_MODE,
    ['one-bucket', 'multi-bucket'] as const,
    'multi-bucket'
  );
  const defaults: StorageRuntimeDefaults = {
    hotReadLayer: readEnumValue(
      'CDNGINE_HOT_READ_LAYER',
      environment.CDNGINE_HOT_READ_LAYER,
      ['none', 'nydus', 'alluxio'] as const,
      'none'
    ),
    sourceDeliveryMode: readEnumValue(
      'CDNGINE_SOURCE_DELIVERY_MODE',
      environment.CDNGINE_SOURCE_DELIVERY_MODE,
      ['proxy', 'materialized-export', 'lazy-read'] as const,
      'proxy'
    ),
    tieringSubstrate: readEnumValue(
      'CDNGINE_TIERING_SUBSTRATE',
      environment.CDNGINE_TIERING_SUBSTRATE,
      ['rustfs', 'seaweedfs'] as const,
      'rustfs'
    )
  };
  const layout: StorageLayoutInput =
    layoutMode === 'one-bucket'
      ? {
          mode: 'one-bucket',
          bucket: readRequiredValue(environment, 'CDNGINE_STORAGE_BUCKET'),
          prefixes: {
            ingest: readPrefix(environment, 'CDNGINE_INGEST_PREFIX', 'ingest'),
            source: readPrefix(environment, 'CDNGINE_SOURCE_PREFIX', 'source'),
            derived: readPrefix(environment, 'CDNGINE_DERIVED_PREFIX', 'derived'),
            exports: readPrefix(environment, 'CDNGINE_EXPORTS_PREFIX', 'exports')
          }
        }
      : {
          mode: 'multi-bucket',
          buckets: {
            ingest: readRequiredValue(environment, 'CDNGINE_INGEST_BUCKET'),
            source: readRequiredValue(environment, 'CDNGINE_SOURCE_BUCKET'),
            derived: readRequiredValue(environment, 'CDNGINE_DERIVED_BUCKET'),
            exports: readRequiredValue(environment, 'CDNGINE_EXPORTS_BUCKET')
          },
          prefixes: {
            ingest: readPrefix(environment, 'CDNGINE_INGEST_PREFIX', 'ingest'),
            source: readPrefix(environment, 'CDNGINE_SOURCE_PREFIX', 'source'),
            derived: readPrefix(environment, 'CDNGINE_DERIVED_PREFIX', 'derived'),
            exports: readPrefix(environment, 'CDNGINE_EXPORTS_PREFIX', 'exports')
          }
        };

  return {
    defaults,
    layout,
    normalized: normalizeStorageLayout(layout)
  };
}
