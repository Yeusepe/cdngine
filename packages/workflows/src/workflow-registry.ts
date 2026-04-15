/**
 * Purpose: Defines the workflow-template registry that resolves stable template IDs into Temporal workflow types and task queues.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/versioning-and-compatibility.md
 * - docs/temporal-message-contracts.md
 * External references:
 * - https://docs.temporal.io/workflow-execution/workflowid-runid
 * - https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning
 * Tests:
 * - packages/workflows/test/dispatch-runtime.test.mjs
 */

import {
  defaultWorkflowTemplates,
  type WorkflowTemplateRegistration
} from './workflow-templates.js';

export class UnknownWorkflowTemplateError extends Error {
  constructor(readonly workflowTemplateId: string) {
    super(`Workflow template "${workflowTemplateId}" is not registered.`);
    this.name = 'UnknownWorkflowTemplateError';
  }
}

export class WorkflowTemplateRegistry {
  private readonly templates = new Map<string, WorkflowTemplateRegistration>();

  constructor(registrations: WorkflowTemplateRegistration[] = defaultWorkflowTemplates) {
    for (const registration of registrations) {
      this.register(registration);
    }
  }

  list(): WorkflowTemplateRegistration[] {
    return [...this.templates.values()].map((registration) => ({ ...registration }));
  }

  register(registration: WorkflowTemplateRegistration): void {
    this.templates.set(registration.workflowTemplateId, { ...registration });
  }

  resolve(workflowTemplateId: string): WorkflowTemplateRegistration {
    const registration = this.templates.get(workflowTemplateId);

    if (!registration) {
      throw new UnknownWorkflowTemplateError(workflowTemplateId);
    }

    return { ...registration };
  }
}
