/**
 * Purpose: Resolves the delivery scopes that a published asset version should materialize into without baking scope rules into worker code.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/persistence-model.md
 * - docs/domain-model.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/relation-queries
 * Tests:
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

export interface PublicationTargetRecord {
  deliveryScopeId: string;
  scopeKey: string;
}

export interface PublicationTargetStore {
  listPublicationTargets(versionId: string): Promise<PublicationTargetRecord[]>;
}

