/**
 * Purpose: Defines the registry-owned workflow-dispatch store contract and a deterministic in-memory implementation for dispatch-runtime tests and early runtime wiring.
 * Governing docs:
 * - docs/persistence-model.md
 * - docs/idempotency-and-dispatch.md
 * - docs/state-machines.md
 * - docs/workflow-extensibility.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.postgresql.org/docs/
 * Tests:
 * - packages/registry/test/workflow-dispatch-store.test.mjs
 */

export type WorkflowDispatchLifecycleState =
  | 'pending'
  | 'starting'
  | 'started'
  | 'duplicate'
  | 'failed_retryable'
  | 'failed_terminal';

export type WorkflowRunLifecycleState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'cancelled'
  | 'failed'
  | 'completed';

export interface WorkflowDispatchRecord {
  assetVersionId: string;
  createdAt: Date;
  dispatchId: string;
  dispatchReason: string;
  dispatchState: WorkflowDispatchLifecycleState;
  firstAttemptAt?: Date;
  lastAttemptAt?: Date;
  lastFailureClass?: string;
  retrySummary?: Record<string, unknown>;
  updatedAt: Date;
  versionToken: number;
  workflowKey: string;
  workflowTemplateId: string;
}

export interface ClaimedWorkflowDispatch extends WorkflowDispatchRecord {
  dispatchState: 'starting';
}

export interface WorkflowRunRecord {
  assetVersionId: string;
  cancellationCause?: string;
  completedAt?: Date;
  createdAt: Date;
  currentPhase?: string;
  lastOperatorAction?: string;
  retrySummary?: Record<string, unknown>;
  startedAt?: Date;
  state: WorkflowRunLifecycleState;
  updatedAt: Date;
  waitReason?: string;
  workflowDispatchId?: string;
  workflowId: string;
  workflowRunId: string;
  workflowTemplateId: string;
}

export interface ClaimPendingWorkflowDispatchesInput {
  claimedAt: Date;
  limit: number;
}

export interface RecordStartedWorkflowDispatchInput {
  currentPhase?: string;
  dispatchId: string;
  expectedVersionToken: number;
  startedAt: Date;
  workflowId: string;
}

export interface RecordDuplicateWorkflowDispatchInput {
  currentPhase?: string;
  dispatchId: string;
  expectedVersionToken: number;
  observedAt: Date;
  workflowId: string;
  workflowRunState?: Extract<WorkflowRunLifecycleState, 'queued' | 'running' | 'waiting'>;
}

export interface RecordFailedWorkflowDispatchInput {
  dispatchId: string;
  expectedVersionToken: number;
  failedAt: Date;
  failureClass: string;
  retrySummary?: Record<string, unknown>;
}

export interface WorkflowDispatchStore {
  claimPendingDispatches(
    input: ClaimPendingWorkflowDispatchesInput
  ): Promise<ClaimedWorkflowDispatch[]>;
  getDispatch(dispatchId: string): Promise<WorkflowDispatchRecord | null>;
  listWorkflowRuns(assetVersionId?: string): Promise<WorkflowRunRecord[]>;
  recordDuplicate(input: RecordDuplicateWorkflowDispatchInput): Promise<void>;
  recordFailedRetryable(input: RecordFailedWorkflowDispatchInput): Promise<void>;
  recordFailedTerminal(input: RecordFailedWorkflowDispatchInput): Promise<void>;
  recordStarted(input: RecordStartedWorkflowDispatchInput): Promise<void>;
}

export class WorkflowDispatchNotFoundError extends Error {
  constructor(readonly dispatchId: string) {
    super(`Workflow dispatch "${dispatchId}" does not exist.`);
    this.name = 'WorkflowDispatchNotFoundError';
  }
}

export class WorkflowDispatchVersionConflictError extends Error {
  constructor(readonly dispatchId: string, readonly expectedVersionToken: number) {
    super(
      `Workflow dispatch "${dispatchId}" no longer has expected version token ${expectedVersionToken}.`
    );
    this.name = 'WorkflowDispatchVersionConflictError';
  }
}

export class WorkflowDispatchStateTransitionError extends Error {
  constructor(
    readonly dispatchId: string,
    readonly fromState: WorkflowDispatchLifecycleState,
    readonly toState: WorkflowDispatchLifecycleState
  ) {
    super(`Workflow dispatch "${dispatchId}" cannot transition from "${fromState}" to "${toState}".`);
    this.name = 'WorkflowDispatchStateTransitionError';
  }
}

export interface SeedWorkflowDispatchRecord {
  assetVersionId: string;
  createdAt?: Date;
  dispatchId: string;
  dispatchReason: string;
  dispatchState?: WorkflowDispatchLifecycleState;
  firstAttemptAt?: Date;
  lastAttemptAt?: Date;
  lastFailureClass?: string;
  retrySummary?: Record<string, unknown>;
  updatedAt?: Date;
  versionToken?: number;
  workflowKey: string;
  workflowTemplateId: string;
}

export interface InMemoryWorkflowDispatchStoreOptions {
  dispatches?: SeedWorkflowDispatchRecord[];
  generateId?: (prefix: 'wfr') => string;
}

function cloneDate(value: Date): Date {
  return new Date(value);
}

function cloneJsonRecord(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return { ...value };
}

function cloneDispatchRecord(record: WorkflowDispatchRecord): WorkflowDispatchRecord {
  return {
    assetVersionId: record.assetVersionId,
    createdAt: cloneDate(record.createdAt),
    dispatchId: record.dispatchId,
    dispatchReason: record.dispatchReason,
    dispatchState: record.dispatchState,
    ...(record.firstAttemptAt ? { firstAttemptAt: cloneDate(record.firstAttemptAt) } : {}),
    ...(record.lastAttemptAt ? { lastAttemptAt: cloneDate(record.lastAttemptAt) } : {}),
    ...(record.lastFailureClass ? { lastFailureClass: record.lastFailureClass } : {}),
    ...(record.retrySummary
      ? { retrySummary: cloneJsonRecord(record.retrySummary) ?? {} }
      : {}),
    updatedAt: cloneDate(record.updatedAt),
    versionToken: record.versionToken,
    workflowKey: record.workflowKey,
    workflowTemplateId: record.workflowTemplateId
  };
}

function cloneWorkflowRunRecord(record: WorkflowRunRecord): WorkflowRunRecord {
  return {
    assetVersionId: record.assetVersionId,
    ...(record.cancellationCause ? { cancellationCause: record.cancellationCause } : {}),
    ...(record.completedAt ? { completedAt: cloneDate(record.completedAt) } : {}),
    createdAt: cloneDate(record.createdAt),
    ...(record.currentPhase ? { currentPhase: record.currentPhase } : {}),
    ...(record.lastOperatorAction ? { lastOperatorAction: record.lastOperatorAction } : {}),
    ...(record.retrySummary
      ? { retrySummary: cloneJsonRecord(record.retrySummary) ?? {} }
      : {}),
    ...(record.startedAt ? { startedAt: cloneDate(record.startedAt) } : {}),
    state: record.state,
    updatedAt: cloneDate(record.updatedAt),
    ...(record.waitReason ? { waitReason: record.waitReason } : {}),
    ...(record.workflowDispatchId ? { workflowDispatchId: record.workflowDispatchId } : {}),
    workflowId: record.workflowId,
    workflowRunId: record.workflowRunId,
    workflowTemplateId: record.workflowTemplateId
  };
}

export class InMemoryWorkflowDispatchStore implements WorkflowDispatchStore {
  private readonly dispatches = new Map<string, WorkflowDispatchRecord>();
  private readonly workflowRunsById = new Map<string, WorkflowRunRecord>();
  private readonly workflowRunsByWorkflowId = new Map<string, string>();
  private readonly generateId: (prefix: 'wfr') => string;

  constructor(options: InMemoryWorkflowDispatchStoreOptions = {}) {
    this.generateId =
      options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 26)}`);

    for (const dispatch of options.dispatches ?? []) {
      const createdAt = dispatch.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
      const updatedAt = dispatch.updatedAt ?? createdAt;

      this.dispatches.set(dispatch.dispatchId, {
        assetVersionId: dispatch.assetVersionId,
        createdAt,
        dispatchId: dispatch.dispatchId,
        dispatchReason: dispatch.dispatchReason,
        dispatchState: dispatch.dispatchState ?? 'pending',
        ...(dispatch.firstAttemptAt ? { firstAttemptAt: dispatch.firstAttemptAt } : {}),
        ...(dispatch.lastAttemptAt ? { lastAttemptAt: dispatch.lastAttemptAt } : {}),
        ...(dispatch.lastFailureClass ? { lastFailureClass: dispatch.lastFailureClass } : {}),
        ...(dispatch.retrySummary
          ? { retrySummary: cloneJsonRecord(dispatch.retrySummary) ?? {} }
          : {}),
        updatedAt,
        versionToken: dispatch.versionToken ?? 1,
        workflowKey: dispatch.workflowKey,
        workflowTemplateId: dispatch.workflowTemplateId
      });
    }
  }

  async claimPendingDispatches(
    input: ClaimPendingWorkflowDispatchesInput
  ): Promise<ClaimedWorkflowDispatch[]> {
    const claimed: ClaimedWorkflowDispatch[] = [];
    const sortedDispatches = [...this.dispatches.values()].sort((left, right) => {
      const createdDiff = left.createdAt.getTime() - right.createdAt.getTime();
      return createdDiff !== 0 ? createdDiff : left.dispatchId.localeCompare(right.dispatchId);
    });

    for (const dispatch of sortedDispatches) {
      if (claimed.length >= input.limit) {
        break;
      }

      if (dispatch.dispatchState !== 'pending' && dispatch.dispatchState !== 'failed_retryable') {
        continue;
      }

      dispatch.dispatchState = 'starting';
      dispatch.updatedAt = cloneDate(input.claimedAt);
      dispatch.lastAttemptAt = cloneDate(input.claimedAt);
      dispatch.firstAttemptAt ??= cloneDate(input.claimedAt);
      dispatch.versionToken += 1;

      claimed.push(cloneDispatchRecord(dispatch) as ClaimedWorkflowDispatch);
    }

    return claimed;
  }

  async getDispatch(dispatchId: string): Promise<WorkflowDispatchRecord | null> {
    const record = this.dispatches.get(dispatchId);
    return record ? cloneDispatchRecord(record) : null;
  }

  async listWorkflowRuns(assetVersionId?: string): Promise<WorkflowRunRecord[]> {
    const records = [...this.workflowRunsById.values()]
      .filter((record) => (assetVersionId ? record.assetVersionId === assetVersionId : true))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    return records.map((record) => cloneWorkflowRunRecord(record));
  }

  async recordStarted(input: RecordStartedWorkflowDispatchInput): Promise<void> {
    const dispatch = this.getMutableDispatch(input.dispatchId, input.expectedVersionToken);

    if (dispatch.dispatchState !== 'starting') {
      throw new WorkflowDispatchStateTransitionError(
        dispatch.dispatchId,
        dispatch.dispatchState,
        'started'
      );
    }

    dispatch.dispatchState = 'started';
    dispatch.updatedAt = cloneDate(input.startedAt);
    dispatch.lastAttemptAt = cloneDate(input.startedAt);
    dispatch.versionToken += 1;

    const existingWorkflowRunId = this.workflowRunsByWorkflowId.get(input.workflowId);
    const existingWorkflowRun = existingWorkflowRunId
      ? this.workflowRunsById.get(existingWorkflowRunId)
      : undefined;

    this.upsertWorkflowRun({
      assetVersionId: dispatch.assetVersionId,
      createdAt: existingWorkflowRun?.createdAt
        ? cloneDate(existingWorkflowRun.createdAt)
        : cloneDate(input.startedAt),
      ...(existingWorkflowRun?.state !== 'queued' && existingWorkflowRun?.currentPhase
        ? { currentPhase: existingWorkflowRun.currentPhase }
        : input.currentPhase
          ? { currentPhase: input.currentPhase }
          : {}),
      startedAt: existingWorkflowRun?.startedAt
        ? cloneDate(existingWorkflowRun.startedAt)
        : cloneDate(input.startedAt),
      state:
        existingWorkflowRun && existingWorkflowRun.state !== 'queued'
          ? existingWorkflowRun.state
          : 'queued',
      updatedAt: cloneDate(input.startedAt),
      workflowDispatchId: existingWorkflowRun?.workflowDispatchId ?? dispatch.dispatchId,
      workflowId: input.workflowId,
      workflowTemplateId: dispatch.workflowTemplateId
    });
  }

  async recordDuplicate(input: RecordDuplicateWorkflowDispatchInput): Promise<void> {
    const dispatch = this.getMutableDispatch(input.dispatchId, input.expectedVersionToken);

    if (dispatch.dispatchState !== 'starting') {
      throw new WorkflowDispatchStateTransitionError(
        dispatch.dispatchId,
        dispatch.dispatchState,
        'duplicate'
      );
    }

    dispatch.dispatchState = 'duplicate';
    dispatch.updatedAt = cloneDate(input.observedAt);
    dispatch.lastAttemptAt = cloneDate(input.observedAt);
    dispatch.versionToken += 1;

    this.upsertWorkflowRun({
      assetVersionId: dispatch.assetVersionId,
      createdAt: cloneDate(input.observedAt),
      ...(input.currentPhase ? { currentPhase: input.currentPhase } : {}),
      startedAt: cloneDate(input.observedAt),
      state: input.workflowRunState ?? 'running',
      updatedAt: cloneDate(input.observedAt),
      workflowDispatchId: dispatch.dispatchId,
      workflowId: input.workflowId,
      workflowTemplateId: dispatch.workflowTemplateId
    });
  }

  async recordFailedRetryable(input: RecordFailedWorkflowDispatchInput): Promise<void> {
    this.recordFailure(input, 'failed_retryable');
  }

  async recordFailedTerminal(input: RecordFailedWorkflowDispatchInput): Promise<void> {
    this.recordFailure(input, 'failed_terminal');
  }

  private recordFailure(
    input: RecordFailedWorkflowDispatchInput,
    targetState: Extract<
      WorkflowDispatchLifecycleState,
      'failed_retryable' | 'failed_terminal'
    >
  ) {
    const dispatch = this.getMutableDispatch(input.dispatchId, input.expectedVersionToken);

    if (dispatch.dispatchState !== 'starting') {
      throw new WorkflowDispatchStateTransitionError(
        dispatch.dispatchId,
        dispatch.dispatchState,
        targetState
      );
    }

    dispatch.dispatchState = targetState;
    dispatch.lastAttemptAt = cloneDate(input.failedAt);
    dispatch.lastFailureClass = input.failureClass;
    if (input.retrySummary) {
      dispatch.retrySummary = cloneJsonRecord(input.retrySummary) ?? {};
    } else {
      delete dispatch.retrySummary;
    }
    dispatch.updatedAt = cloneDate(input.failedAt);
    dispatch.versionToken += 1;
  }

  private getMutableDispatch(
    dispatchId: string,
    expectedVersionToken: number
  ): WorkflowDispatchRecord {
    const dispatch = this.dispatches.get(dispatchId);

    if (!dispatch) {
      throw new WorkflowDispatchNotFoundError(dispatchId);
    }

    if (dispatch.versionToken !== expectedVersionToken) {
      throw new WorkflowDispatchVersionConflictError(dispatchId, expectedVersionToken);
    }

    return dispatch;
  }

  private upsertWorkflowRun(
    record: Omit<WorkflowRunRecord, 'workflowRunId'> & { workflowRunId?: string }
  ) {
    const existingRunId = this.workflowRunsByWorkflowId.get(record.workflowId);

    if (existingRunId) {
      const existingRun = this.workflowRunsById.get(existingRunId);

      if (!existingRun) {
        throw new Error(`Workflow run "${existingRunId}" is missing from the in-memory store.`);
      }

      existingRun.assetVersionId = record.assetVersionId;
      if (record.cancellationCause) {
        existingRun.cancellationCause = record.cancellationCause;
      } else {
        delete existingRun.cancellationCause;
      }
      if (record.completedAt) {
        existingRun.completedAt = cloneDate(record.completedAt);
      } else {
        delete existingRun.completedAt;
      }
      existingRun.createdAt = cloneDate(record.createdAt);
      if (record.currentPhase) {
        existingRun.currentPhase = record.currentPhase;
      } else {
        delete existingRun.currentPhase;
      }
      if (record.lastOperatorAction) {
        existingRun.lastOperatorAction = record.lastOperatorAction;
      } else {
        delete existingRun.lastOperatorAction;
      }
      if (record.retrySummary) {
        existingRun.retrySummary = cloneJsonRecord(record.retrySummary) ?? {};
      } else {
        delete existingRun.retrySummary;
      }
      if (record.startedAt) {
        existingRun.startedAt = cloneDate(record.startedAt);
      } else {
        delete existingRun.startedAt;
      }
      existingRun.state = record.state;
      existingRun.updatedAt = cloneDate(record.updatedAt);
      if (record.waitReason) {
        existingRun.waitReason = record.waitReason;
      } else {
        delete existingRun.waitReason;
      }
      if (record.workflowDispatchId) {
        existingRun.workflowDispatchId = record.workflowDispatchId;
      } else {
        delete existingRun.workflowDispatchId;
      }
      existingRun.workflowTemplateId = record.workflowTemplateId;
      return;
    }

    const workflowRunId = record.workflowRunId ?? this.generateId('wfr');
    const workflowRunRecord: WorkflowRunRecord = {
      assetVersionId: record.assetVersionId,
      ...(record.cancellationCause ? { cancellationCause: record.cancellationCause } : {}),
      ...(record.completedAt ? { completedAt: cloneDate(record.completedAt) } : {}),
      createdAt: cloneDate(record.createdAt),
      ...(record.currentPhase ? { currentPhase: record.currentPhase } : {}),
      ...(record.lastOperatorAction ? { lastOperatorAction: record.lastOperatorAction } : {}),
      ...(record.retrySummary
        ? { retrySummary: cloneJsonRecord(record.retrySummary) ?? {} }
        : {}),
      ...(record.startedAt ? { startedAt: cloneDate(record.startedAt) } : {}),
      state: record.state,
      updatedAt: cloneDate(record.updatedAt),
      ...(record.waitReason ? { waitReason: record.waitReason } : {}),
      ...(record.workflowDispatchId ? { workflowDispatchId: record.workflowDispatchId } : {}),
      workflowId: record.workflowId,
      workflowRunId,
      workflowTemplateId: record.workflowTemplateId
    };

    this.workflowRunsById.set(workflowRunId, workflowRunRecord);
    this.workflowRunsByWorkflowId.set(workflowRunRecord.workflowId, workflowRunId);
  }
}
