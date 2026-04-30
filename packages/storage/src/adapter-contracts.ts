/**
 * Purpose: Defines the CDNgine-owned adapter contracts for staging, canonical source, derived delivery, exports, and optional artifact publication.
 * Governing docs:
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/source-plane-strategy.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/original-source-delivery.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://tus.io/protocols/resumable-upload
 * - https://kopia.io/docs/features/
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://restic.readthedocs.io/en/stable/design.html
 * - https://oras.land/docs/
 * Tests:
 * - packages/storage/test/storage-role-config.test.ts
 */

import type { Readable } from 'node:stream';

export type ChecksumAlgorithm = 'sha256';

export interface ObjectChecksum {
  algorithm: ChecksumAlgorithm;
  value: string;
}

export interface StagedObjectDescriptor {
  bucket: string;
  key: string;
  byteLength: bigint;
  checksum?: ObjectChecksum;
  etag?: string;
  lastModifiedAt?: Date;
}

export interface CreateUploadTargetInput {
  objectKey: string;
  contentType: string;
  byteLength: bigint;
  expiresAt: Date;
}

export interface CreateUploadTargetResult {
  method: 'PATCH';
  protocol: 'tus';
  url: string;
  expiresAt: Date;
}

export interface StagingBlobStore {
  createUploadTarget(input: CreateUploadTargetInput): Promise<CreateUploadTargetResult>;
  headObject(objectKey: string): Promise<StagedObjectDescriptor | null>;
  deleteObject(objectKey: string): Promise<void>;
}

export interface SnapshotFromPathInput {
  assetVersionId: string;
  logicalByteLength?: bigint;
  localPath: string;
  sourceFilename: string;
  sourceDigests?: ObjectChecksum[];
  metadata?: Record<string, string>;
}

export type SourceRepositoryEngine = 'kopia' | 'xet' | 'restic' | 'borg' | 'casync' | 'custom';

export type SourceReconstructionHandleKind =
  | 'snapshot'
  | 'manifest'
  | 'chunk-index'
  | 'merkle-root'
  | 'opaque';

export interface SourceReconstructionHandle {
  kind: SourceReconstructionHandleKind;
  value: string;
}

export interface SourceDedupeMetrics {
  chunkCount?: number;
  dedupeRatio?: number;
  reusedChunkCount?: number;
  savingsRatio?: number;
  storedByteLength?: bigint;
}

export interface SnapshotResult {
  repositoryEngine: SourceRepositoryEngine;
  canonicalSourceId: string;
  snapshotId: string;
  logicalPath: string;
  digests: ObjectChecksum[];
  logicalByteLength?: bigint;
  storedByteLength?: bigint;
  dedupeMetrics?: SourceDedupeMetrics;
  reconstructionHandles?: SourceReconstructionHandle[];
  substrateHints?: Record<string, string>;
}

export interface RestoreSnapshotInput {
  canonicalSourceId: string;
  destinationPath: string;
  snapshot?: SnapshotResult;
}

export interface RestoreResult {
  restoredPath: string;
}

export interface SnapshotSummary {
  canonicalSourceId: string;
  snapshotId: string;
  createdAt: Date;
}

export interface SourceRepository {
  snapshotFromPath(input: SnapshotFromPathInput): Promise<SnapshotResult>;
  listSnapshots(assetVersionId: string): Promise<SnapshotSummary[]>;
  restoreToPath(input: RestoreSnapshotInput): Promise<RestoreResult>;
}

export interface PublishObjectInput {
  objectKey: string;
  contentType: string;
  byteLength: bigint;
  body: Uint8Array | string | Readable;
  checksum?: ObjectChecksum;
}

export interface PublishObjectResult {
  bucket: string;
  key: string;
  etag?: string;
}

export interface SignedReadResult {
  url: string;
  expiresAt: Date;
}

export interface DerivedObjectStore {
  publishObject(input: PublishObjectInput): Promise<PublishObjectResult>;
  headObject(objectKey: string): Promise<StagedObjectDescriptor | null>;
  issueSignedReadUrl(objectKey: string, expiresAt: Date): Promise<SignedReadResult>;
}

export interface ExportsObjectStore {
  publishExport(input: PublishObjectInput): Promise<PublishObjectResult>;
  issueSignedReadUrl(objectKey: string, expiresAt: Date): Promise<SignedReadResult>;
  deleteObject(objectKey: string): Promise<void>;
}

export interface PushBundleInput {
  reference: string;
  mediaType: string;
  path: string;
}

export interface ArtifactReference {
  reference: string;
  digest: string;
  mediaType: string;
}

export interface ArtifactPublisher {
  pushBundle(input: PushBundleInput): Promise<ArtifactReference>;
}
