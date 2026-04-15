/**
 * Purpose: Implements S3-compatible staging, derived, and export adapters without leaking raw bucket topology into calling code.
 * Governing docs:
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/original-source-delivery.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://github.com/rustfs/rustfs
 * - https://github.com/seaweedfs/seaweedfs
 * - https://tus.io/protocols/resumable-upload
 * Tests:
 * - packages/storage/test/s3-compatible-object-stores.test.ts
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  CreateUploadTargetInput,
  CreateUploadTargetResult,
  DerivedObjectStore,
  ExportsObjectStore,
  PublishObjectInput,
  PublishObjectResult,
  SignedReadResult,
  StagedObjectDescriptor,
  StagingBlobStore
} from './adapter-contracts.js';
import type { NormalizedStorageRoleTarget } from './storage-role-config.js';

type S3CompatibleClient = Pick<S3Client, 'send'>;
type SignedUrlFactory = (
  client: S3CompatibleClient,
  command: GetObjectCommand,
  expiresInSeconds: number
) => Promise<string>;

export interface S3CompatibleStoreConfig {
  client: S3CompatibleClient;
  target: NormalizedStorageRoleTarget;
}

export interface S3CompatibleStagingBlobStoreConfig extends S3CompatibleStoreConfig {
  uploadBaseUrl: string;
}

function normalizeRelativeObjectKey(objectKey: string): string {
  const normalized = objectKey.trim().replace(/^\/+|\/+$/g, '');

  if (normalized.length === 0) {
    throw new Error('Object keys must be non-empty after normalization.');
  }

  return normalized;
}

function buildQualifiedObjectKey(target: NormalizedStorageRoleTarget, objectKey: string): string {
  return `${target.prefix}/${normalizeRelativeObjectKey(objectKey)}`;
}

function buildTusUploadUrl(baseUrl: string, key: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(normalizedBase);
  const encodedPath = key.split('/').map(encodeURIComponent).join('/');

  url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodedPath}`;
  return url.toString();
}

function normalizeExpiresInSeconds(expiresAt: Date): number {
  const seconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
  return seconds > 0 ? seconds : 1;
}

function isMissingObjectError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey' ||
    message.includes('not found') ||
    message.includes('no such key')
  );
}

function toStagedObjectDescriptor(
  target: NormalizedStorageRoleTarget,
  key: string,
  output: {
    ContentLength?: number;
    ETag?: string;
    LastModified?: Date;
    Metadata?: Record<string, string>;
  }
): StagedObjectDescriptor {
  const checksumValue = output.Metadata?.['cdngine-checksum-sha256'];

  return {
    bucket: target.bucket,
    key,
    byteLength: BigInt(output.ContentLength ?? 0),
    checksum: checksumValue
      ? {
          algorithm: 'sha256',
          value: checksumValue
        }
      : undefined,
    etag: output.ETag,
    lastModifiedAt: output.LastModified
  };
}

abstract class S3CompatibleObjectStoreBase {
  protected constructor(
    protected readonly client: S3CompatibleClient,
    protected readonly target: NormalizedStorageRoleTarget,
    private readonly signedUrlFactory: SignedUrlFactory = getSignedUrl
  ) {}

  protected resolveQualifiedKey(objectKey: string): string {
    return buildQualifiedObjectKey(this.target, objectKey);
  }

  protected async headResolvedObject(qualifiedKey: string): Promise<StagedObjectDescriptor | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.target.bucket,
          Key: qualifiedKey
        })
      );

      return toStagedObjectDescriptor(this.target, qualifiedKey, result);
    } catch (error) {
      if (isMissingObjectError(error)) {
        return null;
      }

      throw error;
    }
  }

  protected async putResolvedObject(
    qualifiedKey: string,
    input: PublishObjectInput
  ): Promise<PublishObjectResult> {
    const metadata =
      input.checksum?.algorithm === 'sha256'
        ? { 'cdngine-checksum-sha256': input.checksum.value }
        : undefined;

    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.target.bucket,
        Key: qualifiedKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: Number(input.byteLength),
        Metadata: metadata
      })
    );

    return {
      bucket: this.target.bucket,
      key: qualifiedKey,
      etag: result.ETag
    };
  }

  protected async deleteResolvedObject(qualifiedKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.target.bucket,
        Key: qualifiedKey
      })
    );
  }

  protected async signResolvedObject(
    qualifiedKey: string,
    expiresAt: Date
  ): Promise<SignedReadResult> {
    const expiresInSeconds = normalizeExpiresInSeconds(expiresAt);
    const url = await this.signedUrlFactory(
      this.client,
      new GetObjectCommand({
        Bucket: this.target.bucket,
        Key: qualifiedKey
      }),
      expiresInSeconds
    );

    return {
      url,
      expiresAt
    };
  }
}

export class S3CompatibleStagingBlobStore
  extends S3CompatibleObjectStoreBase
  implements StagingBlobStore
{
  constructor(
    private readonly config: S3CompatibleStagingBlobStoreConfig,
    signedUrlFactory?: SignedUrlFactory
  ) {
    super(config.client, config.target, signedUrlFactory);
  }

  async createUploadTarget(input: CreateUploadTargetInput): Promise<CreateUploadTargetResult> {
    const qualifiedKey = this.resolveQualifiedKey(input.objectKey);

    return {
      method: 'PATCH',
      protocol: 'tus',
      url: buildTusUploadUrl(this.config.uploadBaseUrl, qualifiedKey),
      expiresAt: input.expiresAt
    };
  }

  async headObject(objectKey: string): Promise<StagedObjectDescriptor | null> {
    return this.headResolvedObject(this.resolveQualifiedKey(objectKey));
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.deleteResolvedObject(this.resolveQualifiedKey(objectKey));
  }
}

export class S3CompatibleDerivedObjectStore
  extends S3CompatibleObjectStoreBase
  implements DerivedObjectStore
{
  constructor(config: S3CompatibleStoreConfig, signedUrlFactory?: SignedUrlFactory) {
    super(config.client, config.target, signedUrlFactory);
  }

  async publishObject(input: PublishObjectInput): Promise<PublishObjectResult> {
    return this.putResolvedObject(this.resolveQualifiedKey(input.objectKey), input);
  }

  async headObject(objectKey: string): Promise<StagedObjectDescriptor | null> {
    return this.headResolvedObject(this.resolveQualifiedKey(objectKey));
  }

  async issueSignedReadUrl(objectKey: string, expiresAt: Date): Promise<SignedReadResult> {
    return this.signResolvedObject(this.resolveQualifiedKey(objectKey), expiresAt);
  }
}

export class S3CompatibleExportsObjectStore
  extends S3CompatibleObjectStoreBase
  implements ExportsObjectStore
{
  constructor(config: S3CompatibleStoreConfig, signedUrlFactory?: SignedUrlFactory) {
    super(config.client, config.target, signedUrlFactory);
  }

  async publishExport(input: PublishObjectInput): Promise<PublishObjectResult> {
    return this.putResolvedObject(this.resolveQualifiedKey(input.objectKey), input);
  }

  async issueSignedReadUrl(objectKey: string, expiresAt: Date): Promise<SignedReadResult> {
    return this.signResolvedObject(this.resolveQualifiedKey(objectKey), expiresAt);
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.deleteResolvedObject(this.resolveQualifiedKey(objectKey));
  }
}
