/**
 * Purpose: Defines the output-delivery workflow template registration and placeholder Temporal workflow export for download-time transformations.
 * Governing docs:
 * - docs/output-workflows.md
 * - docs/workflow-extensibility.md
 * - docs/versioning-and-compatibility.md
 * - docs/temporal-message-contracts.md
 * External references:
 * - https://docs.temporal.io/workflow-execution/workflowid-runid
 * - https://docs.temporal.io/develop/safe-deployments
 * Tests:
 * - packages/workflows/test/output-workflow-templates.test.mjs
 */

import type {
  WorkflowDispatchExecutionInput,
  WorkflowExecutionResult,
  WorkflowTemplateRegistration
} from './workflow-templates.js';

/**
 * Input for output-delivery workflows. Extends the ingest-time dispatch input
 * with the authorization context that arrived at download-authorization time.
 */
export interface OutputWorkflowDispatchExecutionInput extends WorkflowDispatchExecutionInput {
  authorizationKind: 'source' | 'delivery';
  deliveryScopeId?: string;
  idempotencyKey: string;
  outputParameters?: Record<string, unknown>;
  /** The URL that the base authorization step resolved, before transformation. */
  resolvedUrl: string;
}

export async function outputDeliveryWorkflow(
  input: OutputWorkflowDispatchExecutionInput
): Promise<WorkflowExecutionResult> {
  return {
    accepted: true,
    assetVersionId: input.assetVersionId,
    workflowTemplateId: input.workflowTemplateId
  };
}

export const outputWorkflowTemplates: WorkflowTemplateRegistration[] = [
  {
    compatibilityMode: 'pinned',
    taskQueue: 'output-processing',
    workflowTemplateId: 'output-delivery-v1',
    workflowType: 'outputDeliveryWorkflow'
  }
];
