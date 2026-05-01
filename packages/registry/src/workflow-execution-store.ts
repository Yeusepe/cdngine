/**
 * Purpose: Defines the worker-side workflow-run projection contract so execution hosts can publish honest running, completed, and failed workflow state back into the durable registry.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/workflow-extensibility.md
 * - docs/temporal-message-contracts.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * Tests:
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

export interface MarkWorkflowExecutionRunningInput {
  assetVersionId: string;
  currentPhase?: string;
  dispatchId?: string;
  observedAt: Date;
  workflowId: string;
  workflowTemplateId: string;
}

export interface MarkWorkflowExecutionCompletedInput {
  assetVersionId: string;
  completedAt: Date;
  currentPhase?: string;
  workflowId: string;
  workflowTemplateId: string;
}

export interface MarkWorkflowExecutionFailedInput {
  assetVersionId: string;
  currentPhase?: string;
  failedAt: Date;
  failureClass: string;
  retrySummary?: Record<string, unknown>;
  workflowId: string;
  workflowTemplateId: string;
}

export interface WorkflowExecutionStore {
  markCompleted(input: MarkWorkflowExecutionCompletedInput): Promise<void>;
  markFailedRetryable(input: MarkWorkflowExecutionFailedInput): Promise<void>;
  markRunning(input: MarkWorkflowExecutionRunningInput): Promise<void>;
}

