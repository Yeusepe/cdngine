/**
 * Purpose: Implements the runtime that claims pending workflow-dispatch intents, starts Temporal workflows by stable business key, and projects start outcomes back into the registry.
 * Governing docs:
 * - docs/idempotency-and-dispatch.md
 * - docs/workflow-extensibility.md
 * - docs/versioning-and-compatibility.md
 * - docs/temporal-message-contracts.md
 * External references:
 * - https://docs.temporal.io/workflow-execution/workflowid-runid
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://docs.temporal.io/develop/safe-deployments
 * Tests:
 * - packages/workflows/test/dispatch-runtime.test.mjs
 */

import type {
  ClaimedWorkflowDispatch,
  RecordDuplicateWorkflowDispatchInput,
  RecordFailedWorkflowDispatchInput,
  RecordStartedWorkflowDispatchInput,
  WorkflowDispatchStore
} from '@cdngine/registry';

import { UnknownWorkflowTemplateError, WorkflowTemplateRegistry } from './workflow-registry.js';
import type { WorkflowDispatchExecutionInput } from './workflow-templates.js';

export interface WorkflowStartRequest {
  args: [WorkflowDispatchExecutionInput];
  taskQueue: string;
  workflowId: string;
  workflowType: string;
}

export interface WorkflowStartResult {
  workflowId: string;
}

export interface WorkflowStartClient {
  startWorkflow(input: WorkflowStartRequest): Promise<WorkflowStartResult>;
}

export class WorkflowAlreadyStartedError extends Error {
  constructor(readonly workflowId: string, cause?: unknown) {
    super(`Workflow "${workflowId}" is already running.`);
    this.name = 'WorkflowAlreadyStartedError';
    this.cause = cause;
  }
}

export interface WorkflowStartFailureSummary {
  failureClass: string;
  retrySummary?: Record<string, unknown>;
  targetState: 'failed_retryable' | 'failed_terminal';
}

export interface DispatchPendingWorkflowsInput {
  limit?: number;
}

export interface DispatchPendingWorkflowsResult {
  claimedCount: number;
  duplicateCount: number;
  retryableFailureCount: number;
  startedCount: number;
  terminalFailureCount: number;
}

export interface WorkflowDispatchRuntimeOptions {
  batchSize?: number;
  failureClassifier?: (
    error: unknown,
    dispatch: ClaimedWorkflowDispatch
  ) => WorkflowStartFailureSummary;
  now?: () => Date;
  templateRegistry?: WorkflowTemplateRegistry;
}

function defaultFailureClassifier(
  error: unknown,
  _dispatch: ClaimedWorkflowDispatch
): WorkflowStartFailureSummary {
  if (error instanceof UnknownWorkflowTemplateError) {
    return {
      failureClass: 'unknown-workflow-template',
      targetState: 'failed_terminal'
    };
  }

  if (error instanceof Error) {
    return {
      failureClass: error.name || 'workflow-start-failed',
      targetState: 'failed_retryable'
    };
  }

  return {
    failureClass: 'workflow-start-failed',
    targetState: 'failed_retryable'
  };
}

function buildWorkflowInput(dispatch: ClaimedWorkflowDispatch): WorkflowDispatchExecutionInput {
  return {
    assetVersionId: dispatch.assetVersionId,
    dispatchId: dispatch.dispatchId,
    dispatchReason: dispatch.dispatchReason,
    workflowKey: dispatch.workflowKey,
    workflowTemplateId: dispatch.workflowTemplateId
  };
}

export class WorkflowDispatchRuntime {
  private readonly batchSize: number;
  private readonly failureClassifier: (
    error: unknown,
    dispatch: ClaimedWorkflowDispatch
  ) => WorkflowStartFailureSummary;
  private readonly now: () => Date;
  private readonly templateRegistry: WorkflowTemplateRegistry;

  constructor(
    private readonly store: WorkflowDispatchStore,
    private readonly workflowClient: WorkflowStartClient,
    options: WorkflowDispatchRuntimeOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 25;
    this.failureClassifier = options.failureClassifier ?? defaultFailureClassifier;
    this.now = options.now ?? (() => new Date());
    this.templateRegistry = options.templateRegistry ?? new WorkflowTemplateRegistry();
  }

  async dispatchPending(
    input: DispatchPendingWorkflowsInput = {}
  ): Promise<DispatchPendingWorkflowsResult> {
    const claimedAt = this.now();
    const claimed = await this.store.claimPendingDispatches({
      claimedAt,
      limit: input.limit ?? this.batchSize
    });
    const result: DispatchPendingWorkflowsResult = {
      claimedCount: claimed.length,
      duplicateCount: 0,
      retryableFailureCount: 0,
      startedCount: 0,
      terminalFailureCount: 0
    };

    for (const dispatch of claimed) {
      const attemptedAt = this.now();

      try {
        const template = this.templateRegistry.resolve(dispatch.workflowTemplateId);
        const startResult = await this.workflowClient.startWorkflow({
          args: [buildWorkflowInput(dispatch)],
          taskQueue: template.taskQueue,
          workflowId: dispatch.workflowKey,
          workflowType: template.workflowType
        });

        const startedInput: RecordStartedWorkflowDispatchInput = {
          currentPhase: 'accepted',
          dispatchId: dispatch.dispatchId,
          expectedVersionToken: dispatch.versionToken,
          startedAt: attemptedAt,
          workflowId: startResult.workflowId
        };

        await this.store.recordStarted(startedInput);
        result.startedCount += 1;
      } catch (error) {
        if (error instanceof WorkflowAlreadyStartedError) {
          const duplicateInput: RecordDuplicateWorkflowDispatchInput = {
            currentPhase: 'already-running',
            dispatchId: dispatch.dispatchId,
            expectedVersionToken: dispatch.versionToken,
            observedAt: attemptedAt,
            workflowId: error.workflowId,
            workflowRunState: 'running'
          };

          await this.store.recordDuplicate(duplicateInput);
          result.duplicateCount += 1;
          continue;
        }

        const failure = this.failureClassifier(error, dispatch);
        const failureInput: RecordFailedWorkflowDispatchInput = {
          dispatchId: dispatch.dispatchId,
          expectedVersionToken: dispatch.versionToken,
          failedAt: attemptedAt,
          failureClass: failure.failureClass,
          ...(failure.retrySummary ? { retrySummary: failure.retrySummary } : {})
        };

        if (failure.targetState === 'failed_terminal') {
          await this.store.recordFailedTerminal(failureInput);
          result.terminalFailureCount += 1;
          continue;
        }

        await this.store.recordFailedRetryable(failureInput);
        result.retryableFailureCount += 1;
      }
    }

    return result;
  }
}
