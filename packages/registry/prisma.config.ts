/**
 * Purpose: Supplies Prisma CLI configuration for the registry schema using the Prisma 7 datasource-config model.
 * Governing docs:
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/state-machines.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
 * - https://www.prisma.io/docs/orm/reference/prisma-config-reference
 * Tests:
 * - packages/registry/test/schema.test.mjs
 */

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://cdngine:cdngine@localhost:5432/cdngine'
  }
});
