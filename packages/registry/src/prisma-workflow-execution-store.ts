/**
 * Purpose: Projects worker execution state into durable workflow-run, asset-version, and audit records so public and operator reads reflect real background execution.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/persistence-model.md
 * - docs/workflow-extensibility.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * Tests:
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

import { Prisma } from './generated/prisma/client.js';
import { AssetVersionState, WorkflowRunState } from './generated/prisma/enums.js';
import { createRegistryPrismaClient, type RegistryPrismaClient } from './prisma-client.js';
import type {
  MarkWorkflowExecutionCompletedInput,
  MarkWorkflowExecutionFailedInput,
  MarkWorkflowExecutionRunningInput,
  WorkflowExecutionStore
} from './workflow-execution-store.js';

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

export class PrismaWorkflowExecutionStore implements WorkflowExecutionStore {
  constructor(
    private readonly options: {
      prisma?: RegistryPrismaClient;
    } = {}
  ) {}

  private get prisma() {
    return this.options.prisma ?? createRegistryPrismaClient();
  }

  async markRunning(input: MarkWorkflowExecutionRunningInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowRun.upsert({
        where: { workflowId: input.workflowId },
        update: {
          assetVersionId: input.assetVersionId,
          currentPhase: input.currentPhase ?? null,
          startedAt: input.observedAt,
          state: WorkflowRunState.running,
          updatedAt: input.observedAt,
          workflowDispatchId: input.dispatchId ?? null,
          workflowTemplateId: input.workflowTemplateId
        },
        create: {
          assetVersionId: input.assetVersionId,
          currentPhase: input.currentPhase ?? null,
          startedAt: input.observedAt,
          state: WorkflowRunState.running,
          updatedAt: input.observedAt,
          workflowDispatchId: input.dispatchId ?? null,
          workflowId: input.workflowId,
          workflowTemplateId: input.workflowTemplateId
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: 'system',
          assetVersionId: input.assetVersionId,
          correlationId: input.workflowId,
          eventType: 'workflow-run-running',
          payload: {
            currentPhase: input.currentPhase ?? 'running',
            workflowId: input.workflowId,
            workflowTemplateId: input.workflowTemplateId
          }
        }
      });
    });
  }

  async markCompleted(input: MarkWorkflowExecutionCompletedInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowRun.upsert({
        where: { workflowId: input.workflowId },
        update: {
          assetVersionId: input.assetVersionId,
          completedAt: input.completedAt,
          currentPhase: input.currentPhase ?? null,
          state: WorkflowRunState.completed,
          updatedAt: input.completedAt,
          workflowTemplateId: input.workflowTemplateId
        },
        create: {
          assetVersionId: input.assetVersionId,
          completedAt: input.completedAt,
          currentPhase: input.currentPhase ?? null,
          startedAt: input.completedAt,
          state: WorkflowRunState.completed,
          updatedAt: input.completedAt,
          workflowId: input.workflowId,
          workflowTemplateId: input.workflowTemplateId
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: 'system',
          assetVersionId: input.assetVersionId,
          correlationId: input.workflowId,
          eventType: 'workflow-run-completed',
          payload: {
            currentPhase: input.currentPhase ?? 'completed',
            workflowId: input.workflowId,
            workflowTemplateId: input.workflowTemplateId
          }
        }
      });
    });
  }

  async markFailedRetryable(input: MarkWorkflowExecutionFailedInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.assetVersion.update({
        where: { id: input.assetVersionId },
        data: {
          lifecycleState: AssetVersionState.failed_retryable
        }
      });
      await tx.workflowRun.upsert({
        where: { workflowId: input.workflowId },
        update: {
          assetVersionId: input.assetVersionId,
          completedAt: input.failedAt,
          currentPhase: input.currentPhase ?? null,
          retrySummary: input.retrySummary
            ? toJsonValue(input.retrySummary)
            : Prisma.JsonNull,
          state: WorkflowRunState.failed,
          updatedAt: input.failedAt,
          workflowTemplateId: input.workflowTemplateId
        },
        create: {
          assetVersionId: input.assetVersionId,
          completedAt: input.failedAt,
          currentPhase: input.currentPhase ?? null,
          retrySummary: input.retrySummary
            ? toJsonValue(input.retrySummary)
            : Prisma.JsonNull,
          startedAt: input.failedAt,
          state: WorkflowRunState.failed,
          updatedAt: input.failedAt,
          workflowId: input.workflowId,
          workflowTemplateId: input.workflowTemplateId
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: 'system',
          assetVersionId: input.assetVersionId,
          correlationId: input.workflowId,
          eventType: 'workflow-run-failed',
          payload: toJsonValue({
            currentPhase: input.currentPhase ?? 'failed',
            failureClass: input.failureClass,
            retrySummary: input.retrySummary ?? {},
            workflowId: input.workflowId,
            workflowTemplateId: input.workflowTemplateId
          })
        }
      });
    });
  }
}

