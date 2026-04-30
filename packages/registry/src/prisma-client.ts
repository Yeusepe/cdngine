/**
 * Purpose: Creates Prisma registry clients against PostgreSQL using the Prisma 7 node-postgres adapter.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/service-architecture.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://www.prisma.io/docs/orm/reference/prisma-client-reference#adapter
 * - https://www.prisma.io/docs/orm/overview/databases/postgresql
 * Tests:
 * - packages/registry/test/prisma-upload-session-store.test.mjs
 * - packages/registry/test/prisma-workflow-dispatch-store.test.mjs
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export const defaultRegistryDatabaseUrl =
  'postgresql://cdngine:cdngine@localhost:5432/cdngine';

export function resolveRegistryDatabaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  return (
    environment.DATABASE_URL ??
    environment.CDNGINE_DATABASE_URL ??
    defaultRegistryDatabaseUrl
  );
}

export function createRegistryPrismaClient(options: {
  databaseUrl?: string;
  environment?: NodeJS.ProcessEnv;
} = {}) {
  const adapter = new PrismaPg({
    connectionString:
      options.databaseUrl ?? resolveRegistryDatabaseUrl(options.environment ?? process.env)
  });

  return new PrismaClient({ adapter });
}

export type RegistryPrismaClient = ReturnType<typeof createRegistryPrismaClient>;
