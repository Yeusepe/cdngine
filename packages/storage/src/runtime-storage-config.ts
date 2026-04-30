/**
 * Purpose: Loads deployment-time storage topology, source-engine selection, and delivery defaults from environment variables while preserving the logical storage-role model across one-bucket and multi-bucket profiles.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/source-plane-strategy.md
 * - docs/service-architecture.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/original-source-delivery.md
 * External references:
 * - https://docs.docker.com/compose/environment-variables/
 * - https://huggingface.co/docs/xet/en/api
 * - https://kopia.io/docs/reference/command-line/common/snapshot-create/
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
export type SourceRepositoryRuntimeEngine = 'xet' | 'kopia';

export interface XetCommandRuntimeConfig {
  args: string[];
  command: string;
  cwd?: string;
}

export interface XetServiceRuntimeConfig {
  authToken?: string;
  endpoint: string;
}

export interface XetSourceRepositoryRuntimeConfig {
  command?: XetCommandRuntimeConfig;
  service?: XetServiceRuntimeConfig;
  timeoutMs: number;
  workspacePath?: string;
}

export interface KopiaSourceRepositoryRuntimeConfig {
  cwd?: string;
  executable: string;
  timeoutMs: number;
}

export interface SourceRepositoryRuntimeConfig {
  engine: SourceRepositoryRuntimeEngine;
  kopia: KopiaSourceRepositoryRuntimeConfig;
  xet: XetSourceRepositoryRuntimeConfig;
}

export interface StorageRuntimeDefaults {
  hotReadLayer: WorkerHotReadLayer;
  sourceDeliveryMode: SourceDeliveryMode;
  tieringSubstrate: TieringSubstrate;
}

export interface StorageRuntimeConfig {
  defaults: StorageRuntimeDefaults;
  layout: StorageLayoutInput;
  normalized: Record<'ingest' | 'source' | 'derived' | 'exports', NormalizedStorageRoleTarget>;
  sourceRepository: SourceRepositoryRuntimeConfig;
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

function readOptionalValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  if (!(key in environment)) {
    return undefined;
  }

  const value = environment[key]?.trim();

  if (!value) {
    throw new StorageRuntimeConfigError(`${key} cannot be empty when provided.`);
  }

  return value;
}

function readPrefix(environment: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return environment[key]?.trim() || fallback;
}

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number
): number {
  const rawValue = environment[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new StorageRuntimeConfigError(`${key} must be a positive integer. Received "${rawValue}".`);
  }

  return parsed;
}

function readStringArrayValue(environment: NodeJS.ProcessEnv, key: string): string[] {
  const rawValue = environment[key]?.trim();

  if (!rawValue) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse failure.';
    throw new StorageRuntimeConfigError(`${key} must be a JSON array of strings: ${message}`);
  }

  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new StorageRuntimeConfigError(`${key} must be a JSON array of non-empty strings.`);
  }

  return [...parsed];
}

export function resolveSourceRepositoryEngineFromEnvironment(
  environment: NodeJS.ProcessEnv
): SourceRepositoryRuntimeEngine {
  return readEnumValue(
    'CDNGINE_SOURCE_ENGINE',
    environment.CDNGINE_SOURCE_ENGINE,
    ['xet', 'kopia'] as const,
    'xet'
  );
}

export function loadSourceRepositoryRuntimeConfigFromEnvironment(
  environment: NodeJS.ProcessEnv
): SourceRepositoryRuntimeConfig {
  const engine = resolveSourceRepositoryEngineFromEnvironment(environment);
  const xetCommand = readOptionalValue(environment, 'CDNGINE_XET_COMMAND');
  const xetServiceEndpoint = readOptionalValue(environment, 'CDNGINE_XET_SERVICE_ENDPOINT');
  const xetWorkspacePath = readOptionalValue(environment, 'CDNGINE_XET_WORKSPACE_PATH');
  const xetWorkingDirectory = readOptionalValue(environment, 'CDNGINE_XET_WORKING_DIRECTORY');
  const xetAuthToken = readOptionalValue(environment, 'CDNGINE_XET_AUTH_TOKEN');
  const xet: XetSourceRepositoryRuntimeConfig = {
    timeoutMs: readPositiveInteger(environment, 'CDNGINE_XET_TIMEOUT_MS', 30_000),
    ...(xetWorkspacePath ? { workspacePath: xetWorkspacePath } : {}),
    ...(xetCommand
      ? {
          command: {
            command: xetCommand,
            args: readStringArrayValue(environment, 'CDNGINE_XET_COMMAND_ARGS_JSON'),
            ...(xetWorkingDirectory ? { cwd: xetWorkingDirectory } : {})
          }
        }
      : {}),
    ...(xetServiceEndpoint
      ? {
          service: {
            endpoint: xetServiceEndpoint,
            ...(xetAuthToken ? { authToken: xetAuthToken } : {})
          }
        }
      : {})
  };

  if (engine === 'xet' && !xet.command && !xet.service) {
    throw new StorageRuntimeConfigError(
      'Xet runtime config requires CDNGINE_XET_COMMAND or CDNGINE_XET_SERVICE_ENDPOINT.'
    );
  }

  const kopiaWorkingDirectory = readOptionalValue(environment, 'CDNGINE_KOPIA_WORKING_DIRECTORY');
  const kopia: KopiaSourceRepositoryRuntimeConfig = {
    executable: readOptionalValue(environment, 'CDNGINE_KOPIA_EXECUTABLE') ?? 'kopia',
    timeoutMs: readPositiveInteger(environment, 'CDNGINE_KOPIA_TIMEOUT_MS', 30_000),
    ...(kopiaWorkingDirectory ? { cwd: kopiaWorkingDirectory } : {})
  };

  return {
    engine,
    kopia,
    xet
  };
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
    normalized: normalizeStorageLayout(layout),
    sourceRepository: loadSourceRepositoryRuntimeConfigFromEnvironment(environment)
  };
}
