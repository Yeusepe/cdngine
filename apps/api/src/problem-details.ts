/**
 * Purpose: Defines stable RFC 9457 problem-detail helpers so all API surfaces emit the same typed failure envelope.
 * Governing docs:
 * - docs/api-style-guide.md
 * - docs/problem-types.md
 * - docs/security-model.md
 * External references:
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

import type { Context } from 'hono';

import type { ApiEnv } from './api-types.js';

export const problemTypes = {
  checksumMismatch: 'https://docs.cdngine.dev/problems/checksum-mismatch',
  forbidden: 'https://docs.cdngine.dev/problems/forbidden',
  idempotencyKeyConflict: 'https://docs.cdngine.dev/problems/idempotency-key-conflict',
  internalError: 'https://docs.cdngine.dev/problems/internal-error',
  invalidStateTransition: 'https://docs.cdngine.dev/problems/invalid-state-transition',
  invalidRequest: 'https://docs.cdngine.dev/problems/invalid-request',
  notFound: 'https://docs.cdngine.dev/problems/not-found',
  operatorActionRejected: 'https://docs.cdngine.dev/problems/operator-action-rejected',
  scopeNotAllowed: 'https://docs.cdngine.dev/problems/scope-not-allowed',
  unauthorized: 'https://docs.cdngine.dev/problems/unauthorized',
  uploadNotFinished: 'https://docs.cdngine.dev/problems/upload-not-finished',
  uploadSessionExpired: 'https://docs.cdngine.dev/problems/upload-session-expired',
  versionNotReady: 'https://docs.cdngine.dev/problems/version-not-ready',
  upstreamDependencyFailed: 'https://docs.cdngine.dev/problems/upstream-dependency-failed'
} as const;

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  retryable: boolean;
  instance?: string;
  assetId?: string;
  versionId?: string;
  workflowId?: string;
}

export class ProblemDetailError extends Error {
  readonly problem: ProblemDetail;

  constructor(problem: ProblemDetail) {
    super(problem.detail);
    this.name = 'ProblemDetailError';
    this.problem = problem;
  }
}

export function createProblemResponse(context: Context<ApiEnv>, problem: ProblemDetail) {
  return context.json(
    {
      ...problem,
      ...(problem.instance ? {} : { instance: context.req.path })
    },
    problem.status as 400 | 401 | 403 | 404 | 409 | 410 | 415 | 422 | 423 | 500 | 503,
    {
      'content-type': 'application/problem+json',
      'x-request-id': context.get('requestId')
    }
  );
}

export function mapUnknownErrorToProblem(error: unknown): ProblemDetail {
  if (error instanceof ProblemDetailError) {
    return error.problem;
  }

  return {
    type: problemTypes.internalError,
    title: 'Internal error',
    status: 500,
    detail: error instanceof Error ? error.message : 'The API encountered an unexpected error.',
    retryable: false
  };
}
