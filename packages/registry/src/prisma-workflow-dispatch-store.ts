/**
 * Purpose: Persists workflow-dispatch claiming and run projection against the durable registry outbox.
 * Governing docs:
 * - docs/persistence-model.md
 * - docs/idempotency-and-dispatch.md
 * - docs/service-architecture.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.postgresql.org/docs/current/mvcc-intro.html
 * Tests:
 * - packages/registry/test/prisma-workflow-dispatch-store.test.mjs
 */

import { Prisma } from './generated/prisma/client.js';
import { WorkflowDispatchState, WorkflowRunState } from './generated/prisma/enums.js';
import { createRegistryPrismaClient, type RegistryPrismaClient } from './prisma-client.js';
import {
  WorkflowDispatchNotFoundError,
  WorkflowDispatchStateTransitionError,
  WorkflowDispatchVersionConflictError,
  type ClaimedWorkflowDispatch,
  type ClaimPendingWorkflowDispatchesInput,
  type RecordDuplicateWorkflowDispatchInput,
  type RecordFailedWorkflowDispatchInput,
  type RecordStartedWorkflowDispatchInput,
  type WorkflowDispatchRecord,
  type WorkflowDispatchStore,
  type WorkflowRunRecord
} from './workflow-dispatch-store.js';

function cloneDate(value: Date | null | undefined) {
  return value ? new Date(value) : undefined;
}

function asRecord(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)])
    ) as Prisma.InputJsonObject;
  }

  return String(value);
}

function mapDispatchRecord(record: {
  assetVersionId: string;
  createdAt: Date;
  dispatchReason: string;
  dispatchState: string;
  firstAttemptAt: Date | null;
  id: string;
  lastAttemptAt: Date | null;
  lastFailureClass: string | null;
  retrySummary: Prisma.JsonValue | null;
  updatedAt: Date;
  versionToken: number;
  workflowKey: string;
  workflowTemplateId: string;
}): WorkflowDispatchRecord {
  const retrySummary = asRecord(record.retrySummary);

  return {
    assetVersionId: record.assetVersionId,
    createdAt: record.createdAt,
    dispatchId: record.id,
    dispatchReason: record.dispatchReason,
    dispatchState: record.dispatchState as WorkflowDispatchRecord['dispatchState'],
    ...(record.firstAttemptAt ? { firstAttemptAt: record.firstAttemptAt } : {}),
    ...(record.lastAttemptAt ? { lastAttemptAt: record.lastAttemptAt } : {}),
    ...(record.lastFailureClass ? { lastFailureClass: record.lastFailureClass } : {}),
    ...(retrySummary ? { retrySummary } : {}),
    updatedAt: record.updatedAt,
    versionToken: record.versionToken,
    workflowKey: record.workflowKey,
    workflowTemplateId: record.workflowTemplateId
  };
}

function mapWorkflowRunRecord(record: {
  assetVersionId: string;
  cancellationCause: string | null;
  completedAt: Date | null;
  createdAt: Date;
  currentPhase: string | null;
  lastOperatorAction: string | null;
  retrySummary: Prisma.JsonValue | null;
  startedAt: Date | null;
  state: string;
  updatedAt: Date;
  waitReason: string | null;
  workflowDispatchId: string | null;
  workflowId: string;
  workflowTemplateId: string;
  id: string;
}): WorkflowRunRecord {
  const retrySummary = asRecord(record.retrySummary);

  return {
    assetVersionId: record.assetVersionId,
    ...(record.cancellationCause ? { cancellationCause: record.cancellationCause } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    createdAt: record.createdAt,
    ...(record.currentPhase ? { currentPhase: record.currentPhase } : {}),
    ...(record.lastOperatorAction ? { lastOperatorAction: record.lastOperatorAction } : {}),
    ...(retrySummary ? { retrySummary } : {}),
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    state: record.state as WorkflowRunRecord['state'],
    updatedAt: record.updatedAt,
    ...(record.waitReason ? { waitReason: record.waitReason } : {}),
    ...(record.workflowDispatchId ? { workflowDispatchId: record.workflowDispatchId } : {}),
    workflowId: record.workflowId,
    workflowRunId: record.id,
    workflowTemplateId: record.workflowTemplateId
  };
}

export class PrismaWorkflowDispatchStore implements WorkflowDispatchStore {
  constructor(
    private readonly options: {
      prisma?: RegistryPrismaClient;
    } = {}
  ) {}

  private get prisma() {
    return this.options.prisma ?? createRegistryPrismaClient();
  }

  async claimPendingDispatches(
    input: ClaimPendingWorkflowDispatchesInput
  ): Promise<ClaimedWorkflowDispatch[]> {
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.workflowDispatch.findMany({
        where: {
          dispatchState: {
            in: [WorkflowDispatchState.pending, WorkflowDispatchState.failed_retryable]
          }
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: input.limit
      });
      const claimed: ClaimedWorkflowDispatch[] = [];

      for (const candidate of candidates) {
        const updated = await tx.workflowDispatch.updateMany({
          where: {
            dispatchState: {
              in: [WorkflowDispatchState.pending, WorkflowDispatchState.failed_retryable]
            },
            id: candidate.id,
            versionToken: candidate.versionToken
          },
          data: {
            dispatchState: WorkflowDispatchState.starting,
            firstAttemptAt: candidate.firstAttemptAt ?? input.claimedAt,
            lastAttemptAt: input.claimedAt,
            updatedAt: input.claimedAt,
            versionToken: {
              increment: 1
            }
          }
        });

        if (updated.count !== 1) {
          continue;
        }

        const claimedRecord = await tx.workflowDispatch.findUnique({
          where: { id: candidate.id }
        });

        if (claimedRecord) {
          claimed.push(mapDispatchRecord(claimedRecord) as ClaimedWorkflowDispatch);
        }
      }

      return claimed;
    });
  }

  async getDispatch(dispatchId: string): Promise<WorkflowDispatchRecord | null> {
    const dispatch = await this.prisma.workflowDispatch.findUnique({
      where: { id: dispatchId }
    });

    return dispatch ? mapDispatchRecord(dispatch) : null;
  }

  async listWorkflowRuns(assetVersionId?: string): Promise<WorkflowRunRecord[]> {
    const workflowRuns = await this.prisma.workflowRun.findMany({
      ...(assetVersionId ? { where: { assetVersionId } } : {}),
      orderBy: { createdAt: 'asc' }
    });

    return workflowRuns.map((workflowRun) => mapWorkflowRunRecord(workflowRun));
  }

  async recordDuplicate(input: RecordDuplicateWorkflowDispatchInput): Promise<void> {
    await this.transitionDispatch(input.dispatchId, input.expectedVersionToken, 'duplicate', async (tx) => {
      await tx.workflowRun.upsert({
        where: { workflowId: input.workflowId },
        update: {
          assetVersionId: (
            await tx.workflowDispatch.findUniqueOrThrow({
              where: { id: input.dispatchId },
              select: { assetVersionId: true }
            })
          ).assetVersionId,
          currentPhase: input.currentPhase ?? null,
          startedAt: input.observedAt,
          state: input.workflowRunState ?? WorkflowRunState.running,
          updatedAt: input.observedAt,
          workflowDispatchId: input.dispatchId
        },
        create: {
          assetVersionId: (
            await tx.workflowDispatch.findUniqueOrThrow({
              where: { id: input.dispatchId },
              select: { assetVersionId: true, workflowTemplateId: true }
            })
          ).assetVersionId,
          currentPhase: input.currentPhase ?? null,
          startedAt: input.observedAt,
          state: input.workflowRunState ?? WorkflowRunState.running,
          updatedAt: input.observedAt,
          workflowDispatchId: input.dispatchId,
          workflowId: input.workflowId,
          workflowTemplateId: (
            await tx.workflowDispatch.findUniqueOrThrow({
              where: { id: input.dispatchId },
              select: { workflowTemplateId: true }
            })
          ).workflowTemplateId
        }
      });
    }, input.observedAt);
  }

  async recordFailedRetryable(input: RecordFailedWorkflowDispatchInput): Promise<void> {
    await this.recordFailure(input, WorkflowDispatchState.failed_retryable);
  }

  async recordFailedTerminal(input: RecordFailedWorkflowDispatchInput): Promise<void> {
    await this.recordFailure(input, WorkflowDispatchState.failed_terminal);
  }

  async recordStarted(input: RecordStartedWorkflowDispatchInput): Promise<void> {
    await this.transitionDispatch(input.dispatchId, input.expectedVersionToken, 'started', async (tx) => {
      const dispatch = await tx.workflowDispatch.findUniqueOrThrow({
        where: { id: input.dispatchId },
        select: { assetVersionId: true, workflowTemplateId: true }
      });

      await tx.workflowRun.upsert({
        where: { workflowId: input.workflowId },
        update: {
          assetVersionId: dispatch.assetVersionId,
          currentPhase: input.currentPhase ?? null,
          startedAt: input.startedAt,
          state: WorkflowRunState.queued,
          updatedAt: input.startedAt,
          workflowDispatchId: input.dispatchId
        },
        create: {
          assetVersionId: dispatch.assetVersionId,
          currentPhase: input.currentPhase ?? null,
          startedAt: input.startedAt,
          state: WorkflowRunState.queued,
          updatedAt: input.startedAt,
          workflowDispatchId: input.dispatchId,
          workflowId: input.workflowId,
          workflowTemplateId: dispatch.workflowTemplateId
        }
      });
    }, input.startedAt);
  }

  private async recordFailure(
    input: RecordFailedWorkflowDispatchInput,
    targetState: 'failed_retryable' | 'failed_terminal'
  ) {
    await this.transitionDispatch(
      input.dispatchId,
      input.expectedVersionToken,
      targetState,
      async (tx) => {
        await tx.workflowDispatch.update({
          where: { id: input.dispatchId },
          data: {
            lastFailureClass: input.failureClass,
            lastAttemptAt: input.failedAt,
            retrySummary: input.retrySummary
              ? toJsonValue(input.retrySummary)
              : Prisma.JsonNull,
            updatedAt: input.failedAt
          }
        });
      },
      input.failedAt
    );
  }

  private async transitionDispatch(
    dispatchId: string,
    expectedVersionToken: number,
    targetState: 'started' | 'duplicate' | 'failed_retryable' | 'failed_terminal',
    mutation: (tx: Prisma.TransactionClient) => Promise<void>,
    observedAt: Date
  ) {
    await this.prisma.$transaction(async (tx) => {
      const dispatch = await tx.workflowDispatch.findUnique({
        where: { id: dispatchId }
      });

      if (!dispatch) {
        throw new WorkflowDispatchNotFoundError(dispatchId);
      }

      if (dispatch.versionToken !== expectedVersionToken) {
        throw new WorkflowDispatchVersionConflictError(dispatchId, expectedVersionToken);
      }

      if (dispatch.dispatchState !== WorkflowDispatchState.starting) {
        throw new WorkflowDispatchStateTransitionError(
          dispatchId,
          dispatch.dispatchState as WorkflowDispatchRecord['dispatchState'],
          targetState
        );
      }

      await tx.workflowDispatch.update({
        where: { id: dispatchId },
        data: {
          dispatchState: targetState,
          lastAttemptAt: observedAt,
          updatedAt: observedAt,
          versionToken: {
            increment: 1
          }
        }
      });

      await mutation(tx);
    });
  }
}
