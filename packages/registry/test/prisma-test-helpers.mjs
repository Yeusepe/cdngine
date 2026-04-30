/**
 * Purpose: Provisions isolated PostgreSQL schemas for registry integration tests so durable repositories run against real Prisma migrations.
 * Governing docs:
 * - docs/testing-strategy.md
 * - docs/persistence-model.md
 * - docs/domain-model.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.postgresql.org/docs/current/sql-createschema.html
 * Tests:
 * - packages/registry/test/prisma-upload-session-store.test.mjs
 * - packages/registry/test/prisma-workflow-dispatch-store.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRegistryPrismaClient } from '../dist/prisma-client.js';

const registryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaSchemaPath = path.join(registryRoot, 'prisma', 'schema.prisma');
const prismaCliPath = path.resolve(
  registryRoot,
  '..',
  '..',
  'node_modules',
  'prisma',
  'build',
  'index.js'
);
export function resolveRegistryTestDatabaseUrl() {
  return (
    process.env.CDNGINE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://cdngine:cdngine@localhost:55432/cdngine'
  );
}

export async function withRegistryTestDatabase(run) {
  const scope = `test_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;
  const databaseUrl = resolveRegistryTestDatabaseUrl();

  execFileSync(process.execPath, [prismaCliPath, 'migrate', 'deploy', '--schema', prismaSchemaPath], {
    cwd: registryRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    stdio: 'pipe'
  });

  const prisma = createRegistryPrismaClient({
    databaseUrl
  });

  try {
    return await run({ databaseUrl, prisma, schema: scope });
  } finally {
    await prisma.$disconnect();
  }
}
