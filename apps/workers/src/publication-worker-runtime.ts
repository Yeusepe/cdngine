/**
 * Purpose: Executes started publish workflows in the worker process so canonical versions advance through processing to published using registry-backed projection and publication stores.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/workflow-extensibility.md
 * - docs/testing-strategy.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://docs.temporal.io/workflow-execution
 * Tests:
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

import type {
  GenericAssetPublicationStore,
  ImagePublicationStore,
  PresentationPublicationStore,
  PublicationTargetStore,
  WorkflowExecutionStore
} from '@cdngine/registry';
import type { DerivedObjectStore } from '@cdngine/storage';
import {
  runGenericAssetPublicationWorkflow,
  runImagePublicationWorkflow,
  runPresentationPublicationWorkflow,
  type GenericAssetDerivativeActivity,
  type ImageDerivativeActivity,
  type PresentationProcessingActivity,
  type WorkflowDispatchExecutionInput
} from '@cdngine/workflows';

export interface WorkerWorkflowExecutionRequest {
  workflow: WorkflowDispatchExecutionInput;
  workflowId: string;
}

export interface WorkerPublicationRuntimeResult {
  deliveryScopeIds: string[];
  workflowId: string;
  workflowTemplateId: string;
}

export interface WorkerPublicationRuntimeOptions {
  derivedObjectStore: DerivedObjectStore;
  executionStore: WorkflowExecutionStore;
  genericAssetProcessorActivity?: GenericAssetDerivativeActivity;
  genericAssetPublicationStore?: GenericAssetPublicationStore;
  imageProcessorActivity?: ImageDerivativeActivity;
  imagePublicationStore?: ImagePublicationStore;
  now?: () => Date;
  presentationProcessorActivity?: PresentationProcessingActivity;
  presentationPublicationStore?: PresentationPublicationStore;
  publicationTargets: PublicationTargetStore;
}

export class WorkerWorkflowTemplateNotSupportedError extends Error {
  constructor(readonly workflowTemplateId: string) {
    super(`Worker runtime does not support workflow template "${workflowTemplateId}".`);
    this.name = 'WorkerWorkflowTemplateNotSupportedError';
  }
}

export class WorkerPublicationTargetsNotConfiguredError extends Error {
  constructor(readonly assetVersionId: string) {
    super(`Asset version "${assetVersionId}" does not have any eligible delivery scopes.`);
    this.name = 'WorkerPublicationTargetsNotConfiguredError';
  }
}

function summarizeFailure(error: unknown) {
  if (error instanceof Error) {
    return {
      failureClass: error.name || 'worker-publication-failed',
      retrySummary: {
        message: error.message
      }
    };
  }

  return {
    failureClass: 'worker-publication-failed'
  };
}

export class WorkerPublicationRuntime {
  private readonly now: () => Date;

  constructor(private readonly options: WorkerPublicationRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async executeWorkflow(
    request: WorkerWorkflowExecutionRequest
  ): Promise<WorkerPublicationRuntimeResult> {
    const runningAt = this.now();

    await this.options.executionStore.markRunning({
      assetVersionId: request.workflow.assetVersionId,
      currentPhase: 'publishing',
      dispatchId: request.workflow.dispatchId,
      observedAt: runningAt,
      workflowId: request.workflowId,
      workflowTemplateId: request.workflow.workflowTemplateId
    });

    try {
      const publicationTargets = await this.options.publicationTargets.listPublicationTargets(
        request.workflow.assetVersionId
      );

      if (publicationTargets.length === 0) {
        throw new WorkerPublicationTargetsNotConfiguredError(request.workflow.assetVersionId);
      }

      switch (request.workflow.workflowTemplateId) {
        case 'asset-derivation-v1':
          if (
            !this.options.genericAssetPublicationStore ||
            !this.options.genericAssetProcessorActivity
          ) {
            throw new WorkerWorkflowTemplateNotSupportedError(request.workflow.workflowTemplateId);
          }

          for (const target of publicationTargets) {
            await runGenericAssetPublicationWorkflow(
              {
                deliveryScopeId: target.deliveryScopeId,
                versionId: request.workflow.assetVersionId,
                workflowId: request.workflowId
              },
              {
                derivedObjectStore: this.options.derivedObjectStore,
                now: this.now,
                processorActivity: this.options.genericAssetProcessorActivity,
                publicationStore: this.options.genericAssetPublicationStore
              }
            );
          }
          break;
        case 'image-derivation-v1':
          if (!this.options.imagePublicationStore || !this.options.imageProcessorActivity) {
            throw new WorkerWorkflowTemplateNotSupportedError(request.workflow.workflowTemplateId);
          }

          for (const target of publicationTargets) {
            await runImagePublicationWorkflow(
              {
                deliveryScopeId: target.deliveryScopeId,
                versionId: request.workflow.assetVersionId,
                workflowId: request.workflowId
              },
              {
                derivedObjectStore: this.options.derivedObjectStore,
                now: this.now,
                processorActivity: this.options.imageProcessorActivity,
                publicationStore: this.options.imagePublicationStore
              }
            );
          }
          break;
        case 'presentation-normalization-v1':
          if (
            !this.options.presentationPublicationStore ||
            !this.options.presentationProcessorActivity
          ) {
            throw new WorkerWorkflowTemplateNotSupportedError(request.workflow.workflowTemplateId);
          }

          for (const target of publicationTargets) {
            await runPresentationPublicationWorkflow(
              {
                deliveryScopeId: target.deliveryScopeId,
                versionId: request.workflow.assetVersionId,
                workflowId: request.workflowId
              },
              {
                derivedObjectStore: this.options.derivedObjectStore,
                now: this.now,
                processorActivity: this.options.presentationProcessorActivity,
                publicationStore: this.options.presentationPublicationStore
              }
            );
          }
          break;
        default:
          throw new WorkerWorkflowTemplateNotSupportedError(
            request.workflow.workflowTemplateId
          );
      }

      await this.options.executionStore.markCompleted({
        assetVersionId: request.workflow.assetVersionId,
        completedAt: this.now(),
        currentPhase: 'published',
        workflowId: request.workflowId,
        workflowTemplateId: request.workflow.workflowTemplateId
      });

      return {
        deliveryScopeIds: publicationTargets.map((target) => target.deliveryScopeId),
        workflowId: request.workflowId,
        workflowTemplateId: request.workflow.workflowTemplateId
      };
    } catch (error) {
      const failure = summarizeFailure(error);

      await this.options.executionStore.markFailedRetryable({
        assetVersionId: request.workflow.assetVersionId,
        currentPhase: 'failed',
        failedAt: this.now(),
        failureClass: failure.failureClass,
        ...(failure.retrySummary ? { retrySummary: failure.retrySummary } : {}),
        workflowId: request.workflowId,
        workflowTemplateId: request.workflow.workflowTemplateId
      });

      throw error;
    }
  }
}

