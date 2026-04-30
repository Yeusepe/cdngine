/**
 * Purpose: Provides the production-oriented Xet source adapter, including controlled command/service bridges, typed failure mapping, and engine-neutral reconstruction evidence for canonicalization and restore.
 * Governing docs:
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/source-plane-strategy.md
 * - docs/upstream-integration-model.md
 * - docs/architecture.md
 * - docs/service-architecture.md
 * External references:
 * - https://huggingface.co/docs/xet/index
 * - https://huggingface.co/docs/xet/en/upload-protocol
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * - https://huggingface.co/docs/xet/en/api
 * - https://github.com/huggingface/xet-core
 * Tests:
 * - packages/storage/test/xet-source-repository.test.ts
 * - packages/storage/test/xet-bridge.test.ts
 */

import type {
  ObjectChecksum,
  RestoreResult,
  RestoreSnapshotInput,
  SnapshotFromPathInput,
  SnapshotResult,
  SnapshotSummary,
  SourceDedupeMetrics,
  SourceRepository
} from './adapter-contracts.js';
import type { CommandRunner } from './command-runner.js';

export type XetBridgeOperation = 'snapshot' | 'restore';
export type XetBridgeReason =
  | 'command-failed'
  | 'invalid-config'
  | 'invalid-response'
  | 'missing-evidence'
  | 'not-found'
  | 'service-failed'
  | 'timeout';
export type XetBridgeTransport = 'command' | 'config' | 'service' | 'store';

function truncateMessage(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function isCommandTimeoutError(error: unknown): error is { timeoutMs: number } {
  return (
    error instanceof Error &&
    error.name === 'CommandTimeoutError' &&
    typeof (error as { timeoutMs?: unknown }).timeoutMs === 'number'
  );
}

function isCommandExecutionError(
  error: unknown
): error is { result: { exitCode: number; stderr: string; stdout: string } } {
  return (
    error instanceof Error &&
    error.name === 'CommandExecutionError' &&
    typeof (error as { result?: { exitCode?: unknown } }).result?.exitCode === 'number'
  );
}

export class XetBridgeError extends Error {
  readonly cause: unknown;
  readonly details: Record<string, string> | undefined;
  readonly operation: XetBridgeOperation;
  readonly reason: XetBridgeReason;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;
  readonly transport: XetBridgeTransport;

  constructor(options: {
    cause?: unknown;
    details?: Record<string, string>;
    message: string;
    operation: XetBridgeOperation;
    reason: XetBridgeReason;
    retryable?: boolean;
    statusCode?: number;
    transport: XetBridgeTransport;
  }) {
    super(options.message);
    this.name = 'XetBridgeError';
    this.cause = options.cause;
    this.details = options.details;
    this.operation = options.operation;
    this.reason = options.reason;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
    this.transport = options.transport;
  }
}

function createXetInvalidConfigError(message: string): XetBridgeError {
  return new XetBridgeError({
    message,
    operation: 'snapshot',
    reason: 'invalid-config',
    transport: 'config'
  });
}

function createXetInvalidResponseError(
  operation: XetBridgeOperation,
  transport: XetBridgeTransport,
  message: string,
  cause?: unknown
): XetBridgeError {
  return new XetBridgeError({
    cause,
    message,
    operation,
    reason: 'invalid-response',
    transport
  });
}

function createXetMissingEvidenceError(canonicalSourceId: string): XetBridgeError {
  return new XetBridgeError({
    message:
      `Xet restore requires reconstruction evidence for canonical source "${canonicalSourceId}". ` +
      'Pass snapshot evidence from the registry or configure a snapshot store that can resolve it.',
    operation: 'restore',
    reason: 'missing-evidence',
    transport: 'store'
  });
}

function createXetNotFoundError(canonicalSourceId: string): XetBridgeError {
  return new XetBridgeError({
    message: `No Xet snapshot record exists for canonical source "${canonicalSourceId}".`,
    operation: 'restore',
    reason: 'not-found',
    transport: 'store'
  });
}

function createXetServiceFailureError(
  operation: XetBridgeOperation,
  statusCode: number,
  statusText: string,
  responseBody: string
): XetBridgeError {
  const details = truncateMessage(responseBody);

  return new XetBridgeError({
    message:
      `Xet ${operation} service request failed with status ${statusCode} ${statusText}.` +
      (details.length > 0 ? ` Response: ${details}` : ''),
    operation,
    reason: 'service-failed',
    retryable: statusCode >= 500,
    statusCode,
    transport: 'service',
    ...(details.length > 0 ? { details: { responseBody: details } } : {})
  });
}

function mapXetCommandBridgeError(operation: XetBridgeOperation, error: unknown): XetBridgeError {
  if (error instanceof XetBridgeError) {
    return error;
  }

  if (isCommandTimeoutError(error)) {
    return new XetBridgeError({
      cause: error,
      details: {
        timeoutMs: String(error.timeoutMs)
      },
      message: `Xet ${operation} command timed out after ${error.timeoutMs}ms.`,
      operation,
      reason: 'timeout',
      retryable: true,
      transport: 'command'
    });
  }

  if (isCommandExecutionError(error)) {
    return new XetBridgeError({
      cause: error,
      details: {
        exitCode: String(error.result.exitCode)
      },
      message:
        `Xet ${operation} command failed with exit code ${error.result.exitCode}: ` +
        truncateMessage(error.result.stderr || error.result.stdout || 'no output'),
      operation,
      reason: 'command-failed',
      transport: 'command'
    });
  }

  const message = error instanceof Error ? error.message : 'Unknown Xet command bridge failure.';

  return new XetBridgeError({
    cause: error,
    message: `Xet ${operation} command bridge failed: ${truncateMessage(message)}`,
    operation,
    reason: 'command-failed',
    transport: 'command'
  });
}

function mapXetServiceBridgeError(
  operation: XetBridgeOperation,
  error: unknown,
  timeoutMs: number
): XetBridgeError {
  if (error instanceof XetBridgeError) {
    return error;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new XetBridgeError({
      cause: error,
      details: {
        timeoutMs: String(timeoutMs)
      },
      message: `Xet ${operation} service request timed out after ${timeoutMs}ms.`,
      operation,
      reason: 'timeout',
      retryable: true,
      transport: 'service'
    });
  }

  const message = error instanceof Error ? error.message : 'Unknown Xet service bridge failure.';

  return new XetBridgeError({
    cause: error,
    message: `Xet ${operation} service request failed: ${truncateMessage(message)}`,
    operation,
    reason: 'service-failed',
    transport: 'service'
  });
}

export interface XetReconstructionTerm {
  xorbHash: string;
  startChunkIndex: number;
  endChunkIndex: number;
}

export interface XetSnapshotEvidence {
  fileId: string;
  terms: XetReconstructionTerm[];
  shardIds?: string[];
  uploadedXorbHashes?: string[];
  deduplicatedXorbHashes?: string[];
  logicalPath?: string;
  digests?: ObjectChecksum[];
  logicalByteLength?: bigint;
  storedByteLength?: bigint;
  chunkCount?: number;
  reusedChunkCount?: number;
  fetchEndpoint?: string;
}

export interface XetSnapshotRecord {
  assetVersionId: string;
  createdAt: Date;
  evidence: XetSnapshotEvidence;
  snapshot: SnapshotResult;
}

export interface XetSnapshotEvidenceProvider {
  captureSnapshot(input: SnapshotFromPathInput): Promise<XetSnapshotEvidence>;
}

export interface XetSnapshotStore {
  save(record: XetSnapshotRecord): Promise<void>;
  get(canonicalSourceId: string): Promise<XetSnapshotRecord | null>;
  list(assetVersionId: string): Promise<XetSnapshotRecord[]>;
}

export interface XetFileMaterializerInput {
  canonicalSourceId: string;
  destinationPath: string;
  snapshot: SnapshotResult;
  evidence?: XetSnapshotEvidence;
}

export interface XetFileMaterializer {
  materializeFile(input: XetFileMaterializerInput): Promise<void>;
}

export interface XetSourceRepositoryConfig {
  evidenceProvider: XetSnapshotEvidenceProvider;
  snapshotStore: XetSnapshotStore;
  materializer?: XetFileMaterializer;
}

export type XetCommandBigInt = string | number | bigint;

export interface XetSnapshotEvidenceCommandPayload {
  fileId: string;
  terms: Array<{
    xorbHash: string;
    startChunkIndex: number;
    endChunkIndex: number;
  }>;
  shardIds?: string[];
  uploadedXorbHashes?: string[];
  deduplicatedXorbHashes?: string[];
  logicalPath?: string;
  digests?: ObjectChecksum[];
  logicalByteLength?: XetCommandBigInt;
  storedByteLength?: XetCommandBigInt;
  chunkCount?: number;
  reusedChunkCount?: number;
  fetchEndpoint?: string;
}

export interface XetSnapshotDescriptor {
  canonicalSourceId: string;
  snapshotId: string;
  logicalPath: string;
  reconstructionHandles?: SnapshotResult['reconstructionHandles'];
  substrateHints?: SnapshotResult['substrateHints'];
}

export interface CommandBackedXetSnapshotRequest {
  assetVersionId: string;
  localPath: string;
  sourceFilename: string;
  logicalByteLength?: string;
  sourceDigests?: ObjectChecksum[];
  metadata?: Record<string, string>;
}

export interface CommandBackedXetRestoreRequest {
  canonicalSourceId: string;
  destinationPath: string;
  snapshot: XetSnapshotDescriptor;
  evidence?: XetSnapshotEvidenceCommandPayload;
}

export interface XetCommandBridgeConfig {
  runner: CommandRunner;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface XetServiceBridgeConfig {
  authToken?: string;
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  workspacePath?: string;
}

interface XetServiceSnapshotRequest extends CommandBackedXetSnapshotRequest {
  workspacePath?: string;
}

interface XetServiceRestoreRequest {
  canonicalSourceId: string;
  destinationPath: string;
  snapshot: XetSnapshotDescriptor;
  workspacePath?: string;
}

function buildCommandOptions(config: Pick<XetCommandBridgeConfig, 'cwd' | 'env' | 'timeoutMs'>) {
  return {
    ...(config.cwd ? { cwd: config.cwd } : {}),
    ...(config.env ? { env: config.env } : {}),
    ...(typeof config.timeoutMs === 'number' ? { timeoutMs: config.timeoutMs } : {})
  };
}

function cloneDigests(digests: ObjectChecksum[] | undefined): ObjectChecksum[] {
  const seen = new Set<string>();
  const result: ObjectChecksum[] = [];

  for (const digest of digests ?? []) {
    const key = `${digest.algorithm}:${digest.value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      algorithm: digest.algorithm,
      value: digest.value
    });
  }

  return result;
}

function parseJson<T>(
  value: string,
  operation: XetBridgeOperation,
  transport: 'command' | 'service',
  context: string
): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw createXetInvalidResponseError(
      operation,
      transport,
      `Xet ${context} returned invalid JSON.`,
      error
    );
  }
}

function parseOptionalBigInt(value: XetCommandBigInt | undefined, fieldName: string): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`Expected ${fieldName} to be a non-negative integer.`);
    }

    return BigInt(value);
  }

  if (typeof value === 'string' && value.length > 0) {
    return BigInt(value);
  }

  throw new Error(`Expected ${fieldName} to be a bigint-compatible value.`);
}

function validateTerms(terms: XetReconstructionTerm[]): XetReconstructionTerm[] {
  if (terms.length === 0) {
    throw new Error('Xet evidence must include at least one reconstruction term.');
  }

  return terms.map((term, index) => {
    if (!term.xorbHash) {
      throw new Error(`Xet term ${index} is missing a xorb hash.`);
    }

    if (!Number.isInteger(term.startChunkIndex) || term.startChunkIndex < 0) {
      throw new Error(`Xet term ${index} has an invalid start chunk index.`);
    }

    if (!Number.isInteger(term.endChunkIndex) || term.endChunkIndex <= term.startChunkIndex) {
      throw new Error(`Xet term ${index} has an invalid end chunk index.`);
    }

    return {
      xorbHash: term.xorbHash,
      startChunkIndex: term.startChunkIndex,
      endChunkIndex: term.endChunkIndex
    };
  });
}

function buildDedupeMetrics(evidence: XetSnapshotEvidence): SourceDedupeMetrics | undefined {
  const storedByteLength = evidence.storedByteLength;
  const chunkCount = evidence.chunkCount;
  const reusedChunkCount = evidence.reusedChunkCount;

  if (
    storedByteLength === undefined &&
    chunkCount === undefined &&
    reusedChunkCount === undefined
  ) {
    return undefined;
  }

  return {
    ...(chunkCount === undefined ? {} : { chunkCount }),
    ...(reusedChunkCount === undefined ? {} : { reusedChunkCount }),
    ...(storedByteLength === undefined ? {} : { storedByteLength }),
    ...(chunkCount === undefined || reusedChunkCount === undefined || chunkCount === 0
      ? {}
      : {
          dedupeRatio: reusedChunkCount / chunkCount,
          savingsRatio: reusedChunkCount / chunkCount
        })
  };
}

function snapshotToDescriptor(snapshot: SnapshotResult): XetSnapshotDescriptor {
  return {
    canonicalSourceId: snapshot.canonicalSourceId,
    snapshotId: snapshot.snapshotId,
    logicalPath: snapshot.logicalPath,
    ...(snapshot.reconstructionHandles ? { reconstructionHandles: snapshot.reconstructionHandles } : {}),
    ...(snapshot.substrateHints ? { substrateHints: snapshot.substrateHints } : {})
  };
}

function normalizeServiceEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const normalizedPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    url.pathname = normalizedPath;
    return url.toString();
  } catch (error) {
    throw createXetInvalidConfigError(
      `Xet service endpoint must be a valid absolute URL. Received "${endpoint}".`
    );
  }
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

function parseXetEvidencePayloadFromTransport(
  payload: XetSnapshotEvidenceCommandPayload,
  transport: 'command' | 'service'
): XetSnapshotEvidence {
  try {
    return parseXetSnapshotEvidenceCommandPayload(payload);
  } catch (error) {
    throw createXetInvalidResponseError(
      'snapshot',
      transport,
      'Xet snapshot bridge returned invalid reconstruction evidence.',
      error
    );
  }
}

export function createXetSnapshotResult(
  input: SnapshotFromPathInput,
  evidence: XetSnapshotEvidence
): SnapshotResult {
  if (!evidence.fileId) {
    throw new Error('Xet evidence must include a fileId.');
  }

  const normalizedTerms = validateTerms(evidence.terms);
  const digests = cloneDigests(evidence.digests ?? input.sourceDigests);
  const logicalByteLength = evidence.logicalByteLength ?? input.logicalByteLength;
  const dedupeMetrics = buildDedupeMetrics(evidence);

  const result: SnapshotResult = {
    repositoryEngine: 'xet',
    canonicalSourceId: evidence.fileId,
    snapshotId: evidence.fileId,
    logicalPath: evidence.logicalPath ?? input.sourceFilename,
    digests,
    ...(logicalByteLength === undefined ? {} : { logicalByteLength }),
    ...(evidence.storedByteLength === undefined ? {} : { storedByteLength: evidence.storedByteLength }),
    reconstructionHandles: [
      {
        kind: 'manifest',
        value: evidence.fileId
      },
      ...(evidence.shardIds ?? []).map((shardId) => ({
        kind: 'chunk-index' as const,
        value: shardId
      }))
    ],
    substrateHints: {
      manifestKind: 'xet-file-reconstruction',
      termCount: String(normalizedTerms.length),
      uploadedXorbCount: String(evidence.uploadedXorbHashes?.length ?? 0),
      deduplicatedXorbCount: String(evidence.deduplicatedXorbHashes?.length ?? 0),
      ...(evidence.fetchEndpoint ? { fetchEndpoint: evidence.fetchEndpoint } : {})
    }
  };

  if (dedupeMetrics !== undefined) {
    result.dedupeMetrics = dedupeMetrics;
  }

  return result;
}

export function xetSnapshotEvidenceToCommandPayload(
  evidence: XetSnapshotEvidence
): XetSnapshotEvidenceCommandPayload {
  return {
    fileId: evidence.fileId,
    terms: evidence.terms.map((term) => ({
      xorbHash: term.xorbHash,
      startChunkIndex: term.startChunkIndex,
      endChunkIndex: term.endChunkIndex
    })),
    ...(evidence.shardIds ? { shardIds: [...evidence.shardIds] } : {}),
    ...(evidence.uploadedXorbHashes ? { uploadedXorbHashes: [...evidence.uploadedXorbHashes] } : {}),
    ...(evidence.deduplicatedXorbHashes
      ? { deduplicatedXorbHashes: [...evidence.deduplicatedXorbHashes] }
      : {}),
    ...(evidence.logicalPath ? { logicalPath: evidence.logicalPath } : {}),
    ...(evidence.digests ? { digests: cloneDigests(evidence.digests) } : {}),
    ...(evidence.logicalByteLength === undefined
      ? {}
      : { logicalByteLength: evidence.logicalByteLength.toString() }),
    ...(evidence.storedByteLength === undefined
      ? {}
      : { storedByteLength: evidence.storedByteLength.toString() }),
    ...(evidence.chunkCount === undefined ? {} : { chunkCount: evidence.chunkCount }),
    ...(evidence.reusedChunkCount === undefined ? {} : { reusedChunkCount: evidence.reusedChunkCount }),
    ...(evidence.fetchEndpoint ? { fetchEndpoint: evidence.fetchEndpoint } : {})
  };
}

export function parseXetSnapshotEvidenceCommandPayload(
  payload: XetSnapshotEvidenceCommandPayload
): XetSnapshotEvidence {
  if (!payload.fileId) {
    throw new Error('Xet command output is missing fileId.');
  }

  const logicalByteLength =
    payload.logicalByteLength === undefined
      ? undefined
      : parseOptionalBigInt(payload.logicalByteLength, 'logicalByteLength');
  const storedByteLength =
    payload.storedByteLength === undefined
      ? undefined
      : parseOptionalBigInt(payload.storedByteLength, 'storedByteLength');

  const result: XetSnapshotEvidence = {
    fileId: payload.fileId,
    terms: validateTerms(payload.terms),
    ...(payload.shardIds ? { shardIds: [...payload.shardIds] } : {}),
    ...(payload.uploadedXorbHashes ? { uploadedXorbHashes: [...payload.uploadedXorbHashes] } : {}),
    ...(payload.deduplicatedXorbHashes
      ? { deduplicatedXorbHashes: [...payload.deduplicatedXorbHashes] }
      : {}),
    ...(payload.logicalPath ? { logicalPath: payload.logicalPath } : {}),
    ...(payload.digests ? { digests: cloneDigests(payload.digests) } : {}),
    ...(payload.chunkCount === undefined ? {} : { chunkCount: payload.chunkCount }),
    ...(payload.reusedChunkCount === undefined ? {} : { reusedChunkCount: payload.reusedChunkCount }),
    ...(payload.fetchEndpoint ? { fetchEndpoint: payload.fetchEndpoint } : {})
  };

  if (logicalByteLength !== undefined) {
    result.logicalByteLength = logicalByteLength;
  }

  if (storedByteLength !== undefined) {
    result.storedByteLength = storedByteLength;
  }

  return result;
}

export class InMemoryXetSnapshotStore implements XetSnapshotStore {
  private readonly byCanonicalSourceId = new Map<string, XetSnapshotRecord>();
  private readonly byAssetVersionId = new Map<string, XetSnapshotRecord[]>();

  async save(record: XetSnapshotRecord): Promise<void> {
    this.byCanonicalSourceId.set(record.snapshot.canonicalSourceId, record);

    const records = this.byAssetVersionId.get(record.assetVersionId) ?? [];
    records.push(record);
    this.byAssetVersionId.set(record.assetVersionId, records);
  }

  async get(canonicalSourceId: string): Promise<XetSnapshotRecord | null> {
    return this.byCanonicalSourceId.get(canonicalSourceId) ?? null;
  }

  async list(assetVersionId: string): Promise<XetSnapshotRecord[]> {
    return [...(this.byAssetVersionId.get(assetVersionId) ?? [])];
  }
}

export class CommandBackedXetSnapshotEvidenceProvider implements XetSnapshotEvidenceProvider {
  private readonly config: XetCommandBridgeConfig;

  constructor(config: XetCommandBridgeConfig) {
    if (!config.command.trim()) {
      throw createXetInvalidConfigError('Xet command bridge requires a non-empty command.');
    }

    this.config = config;
  }

  async captureSnapshot(input: SnapshotFromPathInput): Promise<XetSnapshotEvidence> {
    const request: CommandBackedXetSnapshotRequest = {
      assetVersionId: input.assetVersionId,
      localPath: input.localPath,
      sourceFilename: input.sourceFilename,
      ...(input.logicalByteLength === undefined
        ? {}
        : { logicalByteLength: input.logicalByteLength.toString() }),
      ...(input.sourceDigests ? { sourceDigests: cloneDigests(input.sourceDigests) } : {}),
      ...(input.metadata ? { metadata: { ...input.metadata } } : {})
    };

    try {
      const result = await this.config.runner.run({
        command: this.config.command,
        args: [...(this.config.args ?? [])],
        stdin: JSON.stringify(request),
        ...buildCommandOptions(this.config)
      });

      return parseXetEvidencePayloadFromTransport(
        parseJson<XetSnapshotEvidenceCommandPayload>(
          result.stdout,
          'snapshot',
          'command',
          'snapshot command'
        ),
        'command'
      );
    } catch (error) {
      throw mapXetCommandBridgeError('snapshot', error);
    }
  }
}

export class CommandBackedXetFileMaterializer implements XetFileMaterializer {
  private readonly config: XetCommandBridgeConfig;

  constructor(config: XetCommandBridgeConfig) {
    if (!config.command.trim()) {
      throw createXetInvalidConfigError('Xet command bridge requires a non-empty command.');
    }

    this.config = config;
  }

  async materializeFile(input: XetFileMaterializerInput): Promise<void> {
    const request: CommandBackedXetRestoreRequest = {
      canonicalSourceId: input.canonicalSourceId,
      destinationPath: input.destinationPath,
      snapshot: snapshotToDescriptor(input.snapshot),
      ...(input.evidence ? { evidence: xetSnapshotEvidenceToCommandPayload(input.evidence) } : {})
    };

    try {
      await this.config.runner.run({
        command: this.config.command,
        args: [...(this.config.args ?? [])],
        stdin: JSON.stringify(request),
        ...buildCommandOptions(this.config)
      });
    } catch (error) {
      throw mapXetCommandBridgeError('restore', error);
    }
  }
}

export class ServiceBackedXetSnapshotEvidenceProvider implements XetSnapshotEvidenceProvider {
  private readonly authToken: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly workspacePath: string | undefined;

  constructor(config: XetServiceBridgeConfig) {
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
      throw createXetInvalidConfigError('Xet service bridge timeout must be a positive integer.');
    }

    this.authToken = config.authToken;
    this.endpoint = normalizeServiceEndpoint(config.endpoint);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs;
    this.workspacePath = config.workspacePath;
  }

  async captureSnapshot(input: SnapshotFromPathInput): Promise<XetSnapshotEvidence> {
    const request: XetServiceSnapshotRequest = {
      assetVersionId: input.assetVersionId,
      localPath: input.localPath,
      sourceFilename: input.sourceFilename,
      ...(input.logicalByteLength === undefined
        ? {}
        : { logicalByteLength: input.logicalByteLength.toString() }),
      ...(input.sourceDigests ? { sourceDigests: cloneDigests(input.sourceDigests) } : {}),
      ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
      ...(this.workspacePath ? { workspacePath: this.workspacePath } : {})
    };

    try {
      const response = await this.fetchImpl(new URL('v1/snapshots', this.endpoint), {
        body: JSON.stringify(request),
        headers: {
          Authorization: this.authToken ? `Bearer ${this.authToken}` : '',
          'content-type': 'application/json'
        },
        method: 'POST',
        signal: createTimeoutSignal(this.timeoutMs)
      });

      if (!response.ok) {
        throw createXetServiceFailureError(
          'snapshot',
          response.status,
          response.statusText,
          await response.text()
        );
      }

      return parseXetEvidencePayloadFromTransport(
        parseJson<XetSnapshotEvidenceCommandPayload>(
          await response.text(),
          'snapshot',
          'service',
          'snapshot service'
        ),
        'service'
      );
    } catch (error) {
      throw mapXetServiceBridgeError('snapshot', error, this.timeoutMs);
    }
  }
}

export class ServiceBackedXetFileMaterializer implements XetFileMaterializer {
  private readonly authToken: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly workspacePath: string | undefined;

  constructor(config: XetServiceBridgeConfig) {
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
      throw createXetInvalidConfigError('Xet service bridge timeout must be a positive integer.');
    }

    this.authToken = config.authToken;
    this.endpoint = normalizeServiceEndpoint(config.endpoint);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs;
    this.workspacePath = config.workspacePath;
  }

  async materializeFile(input: XetFileMaterializerInput): Promise<void> {
    const request: XetServiceRestoreRequest = {
      canonicalSourceId: input.canonicalSourceId,
      destinationPath: input.destinationPath,
      snapshot: snapshotToDescriptor(input.snapshot),
      ...(this.workspacePath ? { workspacePath: this.workspacePath } : {})
    };

    try {
      const response = await this.fetchImpl(new URL('v1/materializations', this.endpoint), {
        body: JSON.stringify(request),
        headers: {
          Authorization: this.authToken ? `Bearer ${this.authToken}` : '',
          'content-type': 'application/json'
        },
        method: 'POST',
        signal: createTimeoutSignal(this.timeoutMs)
      });

      if (!response.ok) {
        throw createXetServiceFailureError(
          'restore',
          response.status,
          response.statusText,
          await response.text()
        );
      }
    } catch (error) {
      throw mapXetServiceBridgeError('restore', error, this.timeoutMs);
    }
  }
}

export class XetSourceRepository implements SourceRepository {
  private readonly config: XetSourceRepositoryConfig;

  constructor(config: XetSourceRepositoryConfig) {
    this.config = config;
  }

  async snapshotFromPath(input: SnapshotFromPathInput): Promise<SnapshotResult> {
    const evidence = await this.config.evidenceProvider.captureSnapshot(input);
    const snapshot = createXetSnapshotResult(input, evidence);

    await this.config.snapshotStore.save({
      assetVersionId: input.assetVersionId,
      createdAt: new Date(),
      evidence,
      snapshot
    });

    return snapshot;
  }

  async listSnapshots(assetVersionId: string): Promise<SnapshotSummary[]> {
    const records = await this.config.snapshotStore.list(assetVersionId);

    return records.map((record) => ({
      canonicalSourceId: record.snapshot.canonicalSourceId,
      snapshotId: record.snapshot.snapshotId,
      createdAt: record.createdAt
    }));
  }

  async restoreToPath(input: RestoreSnapshotInput): Promise<RestoreResult> {
    if (!this.config.materializer) {
      throw new XetBridgeError({
        message: 'Xet restore requires a configured materializer.',
        operation: 'restore',
        reason: 'invalid-config',
        transport: 'config'
      });
    }

    const record = await this.config.snapshotStore.get(input.canonicalSourceId);
    const snapshot = input.snapshot ?? record?.snapshot;

    if (record === null && !input.snapshot) {
      throw createXetNotFoundError(input.canonicalSourceId);
    }

    if (!snapshot) {
      throw createXetMissingEvidenceError(input.canonicalSourceId);
    }

    if (snapshot.canonicalSourceId !== input.canonicalSourceId) {
      throw new XetBridgeError({
        message:
          `Xet restore received snapshot evidence for "${snapshot.canonicalSourceId}" ` +
          `but was asked to restore "${input.canonicalSourceId}".`,
        operation: 'restore',
        reason: 'invalid-config',
        transport: 'config'
      });
    }

    await this.config.materializer.materializeFile({
      canonicalSourceId: input.canonicalSourceId,
      destinationPath: input.destinationPath,
      snapshot,
      ...(record?.evidence ? { evidence: record.evidence } : {})
    });

    return {
      restoredPath: input.destinationPath
    };
  }
}

export const ExperimentalXetSourceRepository = XetSourceRepository;
