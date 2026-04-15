/**
 * Purpose: Adapts the Temporal TypeScript client to the workflow-start boundary used by CDNgine's dispatch runtime.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/idempotency-and-dispatch.md
 * - docs/versioning-and-compatibility.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://docs.temporal.io/workflow-execution/workflowid-runid
 * Tests:
 * - packages/workflows/test/temporal-workflow-client.test.mjs
 */

import {
  WorkflowClient,
  WorkflowExecutionAlreadyStartedError
} from '@temporalio/client';

import {
  WorkflowAlreadyStartedError,
  type WorkflowStartClient,
  type WorkflowStartRequest,
  type WorkflowStartResult
} from './dispatch-runtime.js';

export class TemporalWorkflowStartClient implements WorkflowStartClient {
  constructor(private readonly client: Pick<WorkflowClient, 'start'>) {}

  async startWorkflow(input: WorkflowStartRequest): Promise<WorkflowStartResult> {
    try {
      const handle = await this.client.start(input.workflowType, {
        args: input.args,
        taskQueue: input.taskQueue,
        workflowId: input.workflowId
      });

      return {
        workflowId: handle.workflowId
      };
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        throw new WorkflowAlreadyStartedError(input.workflowId, error);
      }

      throw error;
    }
  }
}
