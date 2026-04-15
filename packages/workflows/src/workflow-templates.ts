/**
 * Purpose: Defines the stable workflow-template registrations and placeholder workflow exports that the dispatch runtime starts by business-keyed Workflow IDs.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/versioning-and-compatibility.md
 * - docs/temporal-message-contracts.md
 * External references:
 * - https://docs.temporal.io/workflow-execution/workflowid-runid
 * - https://docs.temporal.io/develop/safe-deployments
 * Tests:
 * - packages/workflows/test/dispatch-runtime.test.mjs
 */

export interface WorkflowDispatchExecutionInput {
  assetVersionId: string;
  dispatchId: string;
  dispatchReason: string;
  workflowKey: string;
  workflowTemplateId: string;
}

export interface WorkflowExecutionResult {
  accepted: true;
  assetVersionId: string;
  workflowTemplateId: string;
}

export type WorkflowCompatibilityMode = 'pinned' | 'auto-upgrade';

export interface WorkflowTemplateRegistration {
  compatibilityMode: WorkflowCompatibilityMode;
  taskQueue: string;
  workflowTemplateId: string;
  workflowType: string;
}

export async function assetDerivationWorkflow(
  input: WorkflowDispatchExecutionInput
): Promise<WorkflowExecutionResult> {
  return {
    accepted: true,
    assetVersionId: input.assetVersionId,
    workflowTemplateId: input.workflowTemplateId
  };
}

export async function imageDerivationWorkflow(
  input: WorkflowDispatchExecutionInput
): Promise<WorkflowExecutionResult> {
  return {
    accepted: true,
    assetVersionId: input.assetVersionId,
    workflowTemplateId: input.workflowTemplateId
  };
}

export async function mediaDerivationWorkflow(
  input: WorkflowDispatchExecutionInput
): Promise<WorkflowExecutionResult> {
  return {
    accepted: true,
    assetVersionId: input.assetVersionId,
    workflowTemplateId: input.workflowTemplateId
  };
}

export async function presentationNormalizationWorkflow(
  input: WorkflowDispatchExecutionInput
): Promise<WorkflowExecutionResult> {
  return {
    accepted: true,
    assetVersionId: input.assetVersionId,
    workflowTemplateId: input.workflowTemplateId
  };
}

export const defaultWorkflowTemplates: WorkflowTemplateRegistration[] = [
  {
    compatibilityMode: 'pinned',
    taskQueue: 'asset-processing',
    workflowTemplateId: 'asset-derivation-v1',
    workflowType: 'assetDerivationWorkflow'
  },
  {
    compatibilityMode: 'pinned',
    taskQueue: 'image-processing',
    workflowTemplateId: 'image-derivation-v1',
    workflowType: 'imageDerivationWorkflow'
  },
  {
    compatibilityMode: 'pinned',
    taskQueue: 'media-processing',
    workflowTemplateId: 'media-derivation-v1',
    workflowType: 'mediaDerivationWorkflow'
  },
  {
    compatibilityMode: 'pinned',
    taskQueue: 'presentation-processing',
    workflowTemplateId: 'presentation-normalization-v1',
    workflowType: 'presentationNormalizationWorkflow'
  }
];
