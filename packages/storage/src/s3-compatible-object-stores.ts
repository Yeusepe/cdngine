/**
 * Purpose: Implements S3-compatible staging, derived, and export adapters without leaking raw bucket topology into calling code.
 * Governing docs:
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/original-source-delivery.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
 * - https://github.com/rustfs/rustfs
 * - https://github.com/seaweedfs/seaweedfs
 * - https://tus.io/protocols/resumable-upload
 * - https://pkg.go.dev/github.com/tus/tusd/pkg/s3store
 * Tests:
 * - packages/storage/test/s3-compatible-object-stores.test.ts
 * - packages/storage/test/s3-compatible-source-repository.test.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  CreateUploadTargetInput,
  CreateUploadTargetResult,
  DerivedObjectStore,
  ExportsObjectStore,
  PublishObjectInput,
  PublishObjectResult,
  RestoreSnapshotInput,
  RestoreResult,
  SignedReadResult,
  SnapshotFromPathInput,
  SnapshotResult,
  SnapshotSummary,
  SourceRepository,
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

const defaultSignedUrlFactory: SignedUrlFactory = async (client, command, expiresInSeconds) =>
  getSignedUrl(client as S3Client, command, { expiresIn: expiresInSeconds });

export interface S3CompatibleStoreConfig {
  client: S3CompatibleClient;
  target: NormalizedStorageRoleTarget;
}

export interface S3CompatibleSourceRepositoryConfig {
  client: S3CompatibleClient;
  ingestTarget: NormalizedStorageRoleTarget;
  sourceTarget: NormalizedStorageRoleTarget;
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

function encodeCopySource(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}

function buildS3Uri(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/u.exec(uri);

  if (!match?.[1] || !match[2]) {
    throw new Error(`S3 source repository evidence must use s3://bucket/key URIs. Received "${uri}".`);
  }

  return {
    bucket: match[1],
    key: normalizeRelativeObjectKey(match[2])
  };
}

function parseStagingReference(reference: string): { bucket: string; key: string } {
  const match = /^staging:\/\/([^/]+)\/(.+)$/u.exec(reference);

  if (!match?.[1] || !match[2]) {
    throw new Error('Object-store source repository snapshots require staging:// bucket references.');
  }

  return {
    bucket: match[1],
    key: normalizeRelativeObjectKey(match[2])
  };
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

async function bytesFromObjectBody(body: unknown): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  if (typeof body === 'string') {
    return Buffer.from(body);
  }

  if (body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }

  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    const transformToByteArray = body.transformToByteArray;

    if (typeof transformToByteArray === 'function') {
      return transformToByteArray.call(body);
    }
  }

  if (typeof body === 'object' && body !== null && Symbol.asyncIterator in body) {
    const chunks: Uint8Array[] = [];

    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    return Buffer.concat(chunks);
  }

  return Buffer.from(String(body));
}

function toStagedObjectDescriptor(
  target: NormalizedStorageRoleTarget,
  key: string,
  output: {
    ContentLength: number | undefined;
    ETag: string | undefined;
    LastModified: Date | undefined;
    Metadata: Record<string, string> | undefined;
  }
): StagedObjectDescriptor {
  const checksumValue = output.Metadata?.['cdngine-checksum-sha256'];
  const descriptor: StagedObjectDescriptor = {
    bucket: target.bucket,
    key,
    byteLength: BigInt(output.ContentLength ?? 0),
    ...(checksumValue
      ? {
          checksum: {
            algorithm: 'sha256' as const,
            value: checksumValue
          }
        }
      : {}),
    ...(output.ETag ? { etag: output.ETag } : {}),
    ...(output.LastModified ? { lastModifiedAt: output.LastModified } : {})
  };

  return descriptor;
}

abstract class S3CompatibleObjectStoreBase {
  protected readonly client: S3CompatibleClient;
  protected readonly target: NormalizedStorageRoleTarget;
  private readonly signedUrlFactory: SignedUrlFactory;

  protected constructor(
    client: S3CompatibleClient,
    target: NormalizedStorageRoleTarget,
    signedUrlFactory: SignedUrlFactory = defaultSignedUrlFactory
  ) {
    this.client = client;
    this.target = target;
    this.signedUrlFactory = signedUrlFactory;
  }

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

      return toStagedObjectDescriptor(this.target, qualifiedKey, {
        ContentLength: result.ContentLength,
        ETag: result.ETag,
        LastModified: result.LastModified,
        Metadata: result.Metadata
      });
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

    const resultPayload: PublishObjectResult = {
      bucket: this.target.bucket,
      key: qualifiedKey,
      ...(result.ETag ? { etag: result.ETag } : {})
    };

    return resultPayload;
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
  private readonly config: S3CompatibleStagingBlobStoreConfig;

  constructor(
    config: S3CompatibleStagingBlobStoreConfig,
    signedUrlFactory?: SignedUrlFactory
  ) {
    super(config.client, config.target, signedUrlFactory);
    this.config = config;
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

export class S3CompatibleSourceRepository implements SourceRepository {
  private readonly client: S3CompatibleClient;
  private readonly ingestTarget: NormalizedStorageRoleTarget;
  private readonly sourceTarget: NormalizedStorageRoleTarget;

  constructor(config: S3CompatibleSourceRepositoryConfig) {
    this.client = config.client;
    this.ingestTarget = config.ingestTarget;
    this.sourceTarget = config.sourceTarget;
  }

  async snapshotFromPath(input: SnapshotFromPathInput): Promise<SnapshotResult> {
    const staged = parseStagingReference(input.localPath);

    if (staged.bucket !== this.ingestTarget.bucket) {
      throw new Error(
        `Object-store source repository expected staged bucket "${this.ingestTarget.bucket}" but received "${staged.bucket}".`
      );
    }

    if (!staged.key.startsWith(`${this.ingestTarget.prefix}/`)) {
      throw new Error(
        `Object-store source repository expected staged key under "${this.ingestTarget.prefix}/" but received "${staged.key}".`
      );
    }

    const stagedHead = await this.headRequiredObject(staged.bucket, staged.key);
    const sourceKey = buildQualifiedObjectKey(
      this.sourceTarget,
      `${input.assetVersionId}/${input.sourceFilename}`
    );

    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.sourceTarget.bucket,
        CopySource: encodeCopySource(staged.bucket, staged.key),
        Key: sourceKey
      })
    );

    const sourceHead = await this.headRequiredObject(this.sourceTarget.bucket, sourceKey);
    const canonicalUri = buildS3Uri(this.sourceTarget.bucket, sourceKey);
    const metadataChecksum = sourceHead.Metadata?.['cdngine-checksum-sha256'] ?? stagedHead.Metadata?.['cdngine-checksum-sha256'];
    const digests =
      input.sourceDigests && input.sourceDigests.length > 0
        ? input.sourceDigests
        : metadataChecksum
        ? [{ algorithm: 'sha256' as const, value: metadataChecksum }]
        : [];

    return {
      canonicalSourceId: canonicalUri,
      digests,
      logicalPath: sourceKey,
      repositoryEngine: 'object-store',
      snapshotId: canonicalUri,
      ...(input.logicalByteLength ? { logicalByteLength: input.logicalByteLength } : {}),
      storedByteLength: BigInt(sourceHead.ContentLength ?? stagedHead.ContentLength ?? 0),
      reconstructionHandles: [
        {
          kind: 'opaque',
          value: canonicalUri
        }
      ],
      substrateHints: {
        ingestTarget: this.ingestTarget.targetKey,
        repositoryTool: 's3-compatible-object-store',
        sourceTarget: this.sourceTarget.targetKey
      }
    };
  }

  async listSnapshots(assetVersionId: string): Promise<SnapshotSummary[]> {
    const prefix = buildQualifiedObjectKey(this.sourceTarget, `${assetVersionId}/`);
    const snapshots: SnapshotSummary[] = [];
    let continuationToken: string | undefined;

    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.sourceTarget.bucket,
          Prefix: prefix,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {})
        })
      );

      for (const object of result.Contents ?? []) {
        if (!object.Key) {
          continue;
        }

        const canonicalUri = buildS3Uri(this.sourceTarget.bucket, object.Key);
        snapshots.push({
          canonicalSourceId: canonicalUri,
          createdAt: object.LastModified ?? new Date(0),
          snapshotId: canonicalUri
        });
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    return snapshots;
  }

  async restoreToPath(input: RestoreSnapshotInput): Promise<RestoreResult> {
    const source = this.resolveSnapshotObject(input);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: source.bucket,
        Key: source.key
      })
    );

    await mkdir(dirname(input.destinationPath), { recursive: true });
    await writeFile(input.destinationPath, await bytesFromObjectBody(result.Body));

    return {
      restoredPath: input.destinationPath
    };
  }

  private async headRequiredObject(bucket: string, key: string) {
    try {
      return await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );
    } catch (error) {
      if (isMissingObjectError(error)) {
        throw new Error(`Object-store source repository could not find required object "${bucket}/${key}".`);
      }

      throw error;
    }
  }

  private resolveSnapshotObject(input: RestoreSnapshotInput) {
    const handle = input.snapshot?.reconstructionHandles?.find(
      (candidate) => candidate.kind === 'opaque' && candidate.value.startsWith('s3://')
    );

    return parseS3Uri(handle?.value ?? input.snapshot?.snapshotId ?? input.canonicalSourceId);
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
