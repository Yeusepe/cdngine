/**
 * Purpose: Defines the shared Hono context types for request correlation, authentication, scope, and validation across API surfaces.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * - docs/security-model.md
 * - docs/observability.md
 * External references:
 * - https://hono.dev/docs
 * - https://opentelemetry.io/docs/languages/js/
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

import type { Hono } from 'hono';
import type { AuthenticatedActor as SharedAuthenticatedActor } from '@cdngine/auth';

export type ApiSurface = 'public' | 'platform-admin' | 'operator';
export type AuthenticatedActor = SharedAuthenticatedActor;

export interface RequestedScope {
  serviceNamespaceId?: string;
  tenantId?: string;
}

export interface RequestCorrelation {
  requestId: string;
  serviceNamespaceId?: string;
  tenantId?: string;
  assetId?: string;
  versionId?: string;
  workflowId?: string;
}

export interface ApiVariables {
  actor?: AuthenticatedActor;
  correlation: RequestCorrelation;
  requestDeadlineAt: Date;
  requestId: string;
  requestSignal: AbortSignal;
  requestStartedAt: Date;
  requestedScope: RequestedScope;
  surface?: ApiSurface;
  validatedBody?: unknown;
}

export interface ApiEnv {
  Variables: ApiVariables;
}

export type SurfaceRouteRegistrar = (app: Hono<ApiEnv>) => void;
