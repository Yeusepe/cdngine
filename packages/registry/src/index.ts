/**
 * Purpose: Exposes the registry package entrypoint for durable control-plane models, repositories, and idempotency storage helpers.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.prisma.io/docs/orm/prisma-schema/data-model/models
 * - https://www.postgresql.org/docs/
 * Tests:
 * - packages/registry/test/schema.test.mjs
 */

export const registryPackageName = '@cdngine/registry';
export * from './generic-asset-publication-store.js';
export * from './image-publication-store.js';
export * from './publication-target-store.js';
export * from './prisma-client.js';
export * from './prisma-generic-asset-publication-store.js';
export * from './prisma-image-publication-store.js';
export * from './prisma-publication-target-store.js';
export * from './prisma-public-version-read-store.js';
export * from './prisma-presentation-publication-store.js';
export * from './prisma-upload-session-store.js';
export * from './prisma-workflow-execution-store.js';
export * from './prisma-workflow-dispatch-store.js';
export * from './presentation-publication-store.js';
export * from './schema-metadata.js';
export * from './workflow-execution-store.js';
export * from './workflow-dispatch-store.js';
