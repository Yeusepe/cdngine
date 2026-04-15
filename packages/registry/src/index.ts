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
export * from './schema-metadata.js';
