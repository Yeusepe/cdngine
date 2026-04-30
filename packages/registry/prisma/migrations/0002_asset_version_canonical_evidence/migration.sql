-- Purpose: Adds forward-only AssetVersion canonical evidence columns introduced by the Xet rollout without rewriting the applied foundation migration.
-- Governing docs:
-- - docs/domain-model.md
-- - docs/persistence-model.md
-- - docs/testing-strategy.md
-- External references:
-- - https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories
-- - https://www.postgresql.org/docs/current/sql-altertable.html
-- Tests:
-- - packages/registry/test/schema.test.mjs

-- AlterTable
ALTER TABLE "AssetVersion"
    ADD COLUMN "repositoryEngine" TEXT,
    ADD COLUMN "canonicalLogicalByteLength" BIGINT,
    ADD COLUMN "canonicalStoredByteLength" BIGINT,
    ADD COLUMN "sourceReconstructionHandles" JSONB,
    ADD COLUMN "sourceSubstrateHints" JSONB;
