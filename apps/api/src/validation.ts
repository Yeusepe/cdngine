/**
 * Purpose: Exposes a shared Zod-backed JSON validation middleware that turns schema failures into stable RFC 9457 problem responses.
 * Governing docs:
 * - docs/api-style-guide.md
 * - docs/problem-types.md
 * - docs/service-architecture.md
 * External references:
 * - https://hono.dev/docs
 * - https://zod.dev/
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

import type { MiddlewareHandler } from 'hono';
import type { ZodType } from 'zod';

import type { ApiEnv } from './api-types.js';
import { ProblemDetailError, problemTypes } from './problem-details.js';

export function validateJsonBody<TValue>(schema: ZodType<TValue>): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    let payload: unknown;

    try {
      payload = await context.req.json();
    } catch {
      throw new ProblemDetailError({
        type: problemTypes.invalidRequest,
        title: 'Invalid request',
        status: 400,
        detail: 'The request body must contain valid JSON.',
        retryable: false
      });
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new ProblemDetailError({
        type: problemTypes.invalidRequest,
        title: 'Invalid request',
        status: 400,
        detail: parsed.error.issues.map((issue) => issue.message).join('; '),
        retryable: false
      });
    }

    context.set('validatedBody', parsed.data);
    await next();
  };
}
