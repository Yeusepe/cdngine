/**
 * Purpose: Exposes the storage package entrypoint for staging, source, derived, exports, source-runtime selection, and artifact-publication adapter boundaries.
 * Governing docs:
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/original-source-delivery.md
 * - docs/upstream-integration-model.md
 * - docs/architecture.md
 * - docs/technology-profile.md
 * External references:
 * - https://tus.io/protocols/resumable-upload
 * - https://kopia.io/docs/features/
 * - https://oras.land/docs/
 * - https://github.com/rustfs/rustfs
 * - https://github.com/seaweedfs/seaweedfs
 * Tests:
 * - packages/storage/test/storage-role-config.test.ts
 */

export const storagePackageName = '@cdngine/storage';
export * from './adapter-contracts.js';
export * from './canonical-source-evidence.js';
export * from './command-runner.js';
export * from './kopia-source-repository.js';
export * from './oras-artifact-publisher.js';
export * from './runtime-storage-config.js';
export * from './s3-compatible-object-stores.js';
export * from './source-materialization.js';
export * from './source-repository-factory.js';
export * from './storage-role-config.js';
export * from './xet-source-repository.js';
