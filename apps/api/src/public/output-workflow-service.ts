/**
 * Purpose: Defines the output-workflow trigger contract and an in-memory fake implementation for delivery-route tests.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/output-workflows.md
 * - docs/workflow-extensibility.md
 * - docs/security-model.md
 * External references:
 * - https://docs.temporal.io/workflow-execution/workflowid-runid
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * Tests:
 * - apps/api/test/delivery-routes.test.mjs
 */

/** The subset of the output-workflow request supplied by the caller in the authorization body. */
export interface OutputWorkflowRequest {
  outputWorkflowId: string;
  outputParameters?: Record<string, unknown>;
}

/** Everything the OutputWorkflowStore needs to execute and track the run. */
export interface OutputWorkflowTriggerContext {
  assetId: string;
  authorizationKind: 'source' | 'delivery';
  deliveryScopeId?: string;
  idempotencyKey: string;
  now: Date;
  outputWorkflowId: string;
  outputParameters?: Record<string, unknown>;
  /** The URL that the base authorization step resolved, before transformation. */
  resolvedUrl: string;
  versionId: string;
}

export type OutputWorkflowRunState = 'pending' | 'running' | 'complete' | 'failed';

/** The run record returned by the store after triggering an output workflow. */
export interface OutputWorkflowRunRecord {
  /** Present when state === 'complete'. */
  expiresAt?: Date;
  outputWorkflowId: string;
  runId: string;
  state: OutputWorkflowRunState;
  /** The workflow-produced download URL. Present when state === 'complete'. */
  url?: string;
}

export interface OutputWorkflowStore {
  triggerOutputWorkflow(context: OutputWorkflowTriggerContext): Promise<OutputWorkflowRunRecord>;
}

export class UnknownOutputWorkflowError extends Error {
  constructor(readonly outputWorkflowId: string) {
    super(`Output workflow "${outputWorkflowId}" is not registered.`);
    this.name = 'UnknownOutputWorkflowError';
  }
}

export class OutputWorkflowIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was reused for a different output workflow request.`);
    this.name = 'OutputWorkflowIdempotencyConflictError';
  }
}

// ---------------------------------------------------------------------------
// In-memory fake for tests
// ---------------------------------------------------------------------------

/**
 * Handler for InMemoryOutputWorkflowStore. Receives the trigger context and the
 * pre-generated runId (from the store's runIdFactory) and returns the run record.
 */
export type InMemoryOutputWorkflowHandler = (
  context: OutputWorkflowTriggerContext,
  runId: string
) => OutputWorkflowRunRecord;

export interface InMemoryOutputWorkflowStoreOptions {
  handlers?: Map<string, InMemoryOutputWorkflowHandler>;
  runIdFactory?: () => string;
}

interface StoredOutputWorkflowRun {
  fingerprint: string;
  record: OutputWorkflowRunRecord;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => typeof entry !== 'undefined')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprintOutputWorkflowRequest(context: OutputWorkflowTriggerContext) {
  return stableJson({
    assetId: context.assetId,
    authorizationKind: context.authorizationKind,
    ...(context.deliveryScopeId ? { deliveryScopeId: context.deliveryScopeId } : {}),
    outputParameters: context.outputParameters ?? null,
    outputWorkflowId: context.outputWorkflowId,
    versionId: context.versionId
  });
}

function cloneOutputWorkflowRunRecord(
  record: OutputWorkflowRunRecord
): OutputWorkflowRunRecord {
  return {
    ...(record.expiresAt ? { expiresAt: new Date(record.expiresAt) } : {}),
    outputWorkflowId: record.outputWorkflowId,
    runId: record.runId,
    state: record.state,
    ...(record.url ? { url: record.url } : {})
  };
}

export class InMemoryOutputWorkflowStore implements OutputWorkflowStore {
  private readonly handlers: Map<string, InMemoryOutputWorkflowHandler>;
  private readonly runIdFactory: () => string;
  private readonly runsByIdempotencyKey = new Map<string, StoredOutputWorkflowRun>();

  constructor(options: InMemoryOutputWorkflowStoreOptions = {}) {
    this.handlers = options.handlers ?? new Map();
    this.runIdFactory = options.runIdFactory ?? (() => crypto.randomUUID());
  }

  async triggerOutputWorkflow(
    context: OutputWorkflowTriggerContext
  ): Promise<OutputWorkflowRunRecord> {
    const fingerprint = fingerprintOutputWorkflowRequest(context);
    const existing = this.runsByIdempotencyKey.get(context.idempotencyKey);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new OutputWorkflowIdempotencyConflictError(context.idempotencyKey);
      }

      return cloneOutputWorkflowRunRecord(existing.record);
    }

    const handler = this.handlers.get(context.outputWorkflowId);

    if (!handler) {
      throw new UnknownOutputWorkflowError(context.outputWorkflowId);
    }

    const runId = this.runIdFactory();
    const record = handler(context, runId);
    this.runsByIdempotencyKey.set(context.idempotencyKey, {
      fingerprint,
      record: cloneOutputWorkflowRunRecord(record)
    });

    return cloneOutputWorkflowRunRecord(record);
  }
}

/**
 * Returns a handler that immediately resolves with state 'complete' and a URL
 * produced by the provided factory. Use this in tests when you want to verify
 * the full authorization + output-workflow flow without async complexity.
 *
 * The urlFactory receives the trigger context and the pre-generated runId.
 */
export function createImmediateOutputWorkflowHandler(
  urlFactory: (context: OutputWorkflowTriggerContext, runId: string) => string
): InMemoryOutputWorkflowHandler {
  return (context, runId) => ({
    expiresAt: new Date(context.now.getTime() + 15 * 60_000),
    outputWorkflowId: context.outputWorkflowId,
    runId,
    state: 'complete',
    url: urlFactory(context, runId)
  });
}
