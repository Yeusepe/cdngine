/**
 * Purpose: Verifies that durable registry upload-session and public-read stores persist transactional idempotency, canonicalization evidence, source grants, and published read models in PostgreSQL.
 * Governing docs:
 * - docs/persistence-model.md
 * - docs/service-architecture.md
 * - docs/idempotency-and-dispatch.md
 * - docs/domain-model.md
 * Tests:
 * - packages/registry/test/prisma-upload-session-store.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PrismaPublicVersionReadStore,
  PrismaUploadSessionStore,
  RegistryUploadSessionValidationFailedError
} from '../dist/index.js';
import { withRegistryTestDatabase } from './prisma-test-helpers.mjs';

async function seedScope(prisma, scope) {
  const serviceNamespaceId = `media-platform-${scope}`;
  const tenantId = `tenant-acme-${scope}`;
  const scopeKey = `public-default-${scope}`;
  const namespace = await prisma.serviceNamespace.create({
    data: {
      displayName: 'Media Platform',
      serviceNamespaceId,
      tenantIsolationMode: 'shared-tenant'
    }
  });
  const tenant = await prisma.tenantScope.create({
    data: {
      externalTenantId: tenantId,
      serviceNamespaceId: namespace.id
    }
  });
  const deliveryScope = await prisma.deliveryScope.create({
    data: {
      authorizationMode: 'signed_url',
      deliveryMode: 'shared-path',
      hostname: 'cdn.cdngine.local',
      pathPrefix: 'media',
      scopeKey,
      serviceNamespaceId: namespace.id,
      tenantScopeId: tenant.id
    }
  });

  return { deliveryScope, namespace, serviceNamespaceId, tenant, tenantId };
}

test('Prisma upload-session store persists durable completion evidence and public reads', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    const now = new Date('2026-02-01T12:00:00.000Z');
    const { deliveryScope, serviceNamespaceId, tenantId } = await seedScope(prisma, schema);
    const callerScopeKey = `public:user-${schema}`;
    const uploadStore = new PrismaUploadSessionStore({
      now: () => now,
      prisma
    });
    const publicReadStore = new PrismaPublicVersionReadStore({ prisma });

    const issued = await uploadStore.issueUploadSession({
      assetOwner: 'customer:acme',
      byteLength: 1234n,
      callerScopeKey,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      },
      contentType: 'image/png',
      expiresAt: new Date('2026-02-01T12:15:00.000Z'),
      filename: 'hero-banner.png',
      idempotencyKey: `issue-001-${schema}`,
      normalizedRequestHash: `hash-issue-001-${schema}`,
      objectKey: `uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`,
      serviceNamespaceId,
      tenantId
    });

    const replay = await uploadStore.issueUploadSession({
      assetOwner: 'customer:acme',
      byteLength: 1234n,
      callerScopeKey,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      },
      contentType: 'image/png',
      expiresAt: new Date('2026-02-01T12:15:00.000Z'),
      filename: 'hero-banner.png',
      idempotencyKey: `issue-001-${schema}`,
      normalizedRequestHash: `hash-issue-001-${schema}`,
      objectKey: `uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`,
      serviceNamespaceId,
      tenantId
    });

    assert.equal(replay.isDuplicate, true);
    assert.equal(replay.uploadSessionId, issued.uploadSessionId);

    const completed = await uploadStore.completeUploadSession(
      {
        callerScopeKey,
        idempotencyKey: `complete-001-${schema}`,
        normalizedRequestHash: `hash-complete-001-${schema}`,
        stagedObject: {
          byteLength: 1234n,
          checksum: {
            algorithm: 'sha256',
            value: 'abc123'
          },
          descriptor: {
            bucket: 'cdngine-ingest',
            byteLength: 1234n,
            checksum: {
              algorithm: 'sha256',
              value: 'abc123'
            },
            etag: 'abc123',
            key: `ingest/uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`
          },
          objectKey: `uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`
        },
        uploadSessionId: issued.uploadSessionId,
        workflowTemplate: 'image-derivation-v1'
      },
      async () => ({
        canonicalSourceId: `xet_file_patch_${schema}`,
        dedupeMetrics: {
          chunkCount: 16,
          storedByteLength: 256n
        },
        digests: [
          {
            algorithm: 'sha256',
            value: 'abc123'
          }
        ],
        logicalByteLength: 1234n,
        logicalPath: `source/${serviceNamespaceId}/asset/hero-banner.png`,
        reconstructionHandles: [
          {
            kind: 'manifest',
            value: `xet_file_patch_${schema}`
          }
        ],
        repositoryEngine: 'xet',
        snapshotId: `xet_snapshot_${schema}`,
        storedByteLength: 256n,
        substrateHints: {
          repositoryTool: 'xet'
        }
      })
    );

    assert.equal(completed.isDuplicate, false);
    assert.equal(completed.versionState, 'canonical');
    assert.equal(completed.workflowDispatch.state, 'pending');
    assert.equal(completed.canonicalSource.repositoryEngine, 'xet');

    const versionRow = await prisma.assetVersion.findUniqueOrThrow({
      where: { id: issued.versionId }
    });
    assert.equal(versionRow.repositoryEngine, 'xet');
    assert.equal(versionRow.canonicalSourceId, `xet_file_patch_${schema}`);
    assert.equal(versionRow.lifecycleState, 'canonical');
    assert.equal(versionRow.canonicalLogicalByteLength, 1234n);
    assert.equal(versionRow.canonicalStoredByteLength, 256n);
    assert.equal(
      await prisma.workflowDispatch.count({
        where: { assetVersionId: issued.versionId, dispatchState: 'pending' }
      }),
      1
    );
    assert.equal(
      await prisma.idempotencyRecord.count({
        where: {
          callerScopeKey
        }
      }),
      2
    );
    assert.equal(
      await prisma.auditEvent.count({
        where: { assetVersionId: issued.versionId, eventType: 'asset-version-canonicalized' }
      }),
      1
    );

    const version = await publicReadStore.getVersion(issued.assetId, issued.versionId);
    assert.equal(version?.serviceNamespaceId, serviceNamespaceId);
    assert.equal(version?.tenantId, tenantId);
    assert.equal(version?.workflowState, 'pending');
    assert.equal(version?.canonicalSourceEvidence?.repositoryEngine, 'xet');
    assert.deepEqual(version?.canonicalSourceEvidence?.canonicalDigestSet, [
      {
        algorithm: 'sha256',
        value: 'abc123'
      }
    ]);

    const sourceAuthorization = await publicReadStore.authorizeSource(
      issued.assetId,
      issued.versionId,
      'attachment',
      {
        callerScopeKey,
        idempotencyKey: `source-001-${schema}`,
        now,
        oneTime: true
      }
    );
    assert.match(sourceAuthorization.url, /^\/download-links\//u);

    const sourceToken = sourceAuthorization.url.split('/').pop();
    assert.ok(sourceToken);
    const consumedSource = await publicReadStore.consumeDownloadLink(sourceToken, now);
    assert.match(
      consumedSource.url,
      new RegExp(
        `^/v1/assets/${issued.assetId}/versions/${issued.versionId}/source/proxy\\?grantId=`
      )
    );

    await prisma.derivative.create({
      data: {
        assetVersionId: issued.versionId,
        byteLength: 512n,
        checksumValue: 'sha-webp',
        contentType: 'image/webp',
        deliveryScopeId: deliveryScope.id,
        deterministicKey: `deriv/${serviceNamespaceId}/hero-banner/webp-master/${schema}`,
        publicationState: 'published',
        publishedAt: now,
        recipeId: 'webp-master',
        schemaVersion: 'v1',
        storageBucket: 'cdngine-derived',
        storageKey: 'derived/hero-banner.webp',
        variantKey: 'webp-master'
      }
    });
    await prisma.assetManifest.create({
      data: {
        assetVersionId: issued.versionId,
        checksumValue: 'manifest-sha',
        deliveryScopeId: deliveryScope.id,
        manifestPayload: {
          manifestType: 'image-default',
          versionId: issued.versionId
        },
        manifestType: 'image-default',
        objectKey: 'manifests/media-platform/hero-banner/image-default.json',
        publicationState: 'published',
        publishedAt: now,
        schemaVersion: 'v1'
      }
    });
    await prisma.assetVersion.update({
      where: { id: issued.versionId },
      data: { lifecycleState: 'published' }
    });

    const derivatives = await publicReadStore.listDerivatives(issued.assetId, issued.versionId);
    const manifest = await publicReadStore.getManifest(
      issued.assetId,
      issued.versionId,
      'image-default'
    );
    const deliveryAuthorization = await publicReadStore.authorizeDelivery(
      issued.assetId,
      issued.versionId,
      deliveryScope.id,
      'webp-master',
      {
        callerScopeKey,
        idempotencyKey: `delivery-001-${schema}`,
        now,
        oneTime: true
      }
    );

    assert.equal(derivatives.length, 1);
    assert.equal(derivatives[0].variant, 'webp-master');
    assert.equal(manifest?.objectKey, 'manifests/media-platform/hero-banner/image-default.json');
    assert.match(deliveryAuthorization.url, /^\/download-links\//u);

    const deliveryToken = deliveryAuthorization.url.split('/').pop();
    assert.ok(deliveryToken);
    const consumedDelivery = await publicReadStore.consumeDownloadLink(deliveryToken, now);
    assert.equal(
      consumedDelivery.url,
      'https://cdn.cdngine.local/media/derived/hero-banner.webp'
    );
  });
});

test('Prisma upload-session store persists validation failures before canonicalization', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    const now = new Date('2026-02-01T12:00:00.000Z');
    const { serviceNamespaceId, tenantId } = await seedScope(prisma, schema);
    const callerScopeKey = `public:user-${schema}`;
    const uploadStore = new PrismaUploadSessionStore({
      now: () => now,
      prisma
    });

    const issued = await uploadStore.issueUploadSession({
      assetOwner: 'customer:acme',
      byteLength: 1234n,
      callerScopeKey,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      },
      contentType: 'image/png',
      expiresAt: new Date('2026-02-01T12:15:00.000Z'),
      filename: 'hero-banner.png',
      idempotencyKey: `issue-001-${schema}`,
      normalizedRequestHash: `hash-issue-001-${schema}`,
      objectKey: `uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`,
      serviceNamespaceId,
      tenantId
    });

    await assert.rejects(
      () =>
        uploadStore.completeUploadSession(
          {
            callerScopeKey,
            idempotencyKey: `complete-001-${schema}`,
            normalizedRequestHash: `hash-complete-001-${schema}`,
            stagedObject: {
              byteLength: 1234n,
              checksum: {
                algorithm: 'sha256',
                value: 'WRONG'
              },
              descriptor: {
                bucket: 'cdngine-ingest',
                byteLength: 1234n,
                checksum: {
                  algorithm: 'sha256',
                  value: 'WRONG'
                },
                etag: 'WRONG',
                key: `ingest/uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`
              },
              objectKey: `uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`
            },
            uploadSessionId: issued.uploadSessionId,
            workflowTemplate: 'image-derivation-v1'
          },
          async () => {
            throw new Error('canonicalize should not run');
          }
        ),
      (error) =>
        error instanceof RegistryUploadSessionValidationFailedError &&
        error.problemType === 'https://docs.cdngine.dev/problems/checksum-mismatch'
    );

    const version = await prisma.assetVersion.findUniqueOrThrow({
      where: { id: issued.versionId }
    });

    assert.equal(version.lifecycleState, 'failed_validation');
    assert.equal(
      await prisma.validationResult.count({
        where: {
          assetVersionId: issued.versionId,
          problemType: 'https://docs.cdngine.dev/problems/checksum-mismatch'
        }
      }),
      1
    );
    assert.equal(
      await prisma.workflowDispatch.count({
        where: { assetVersionId: issued.versionId }
      }),
      0
    );
  });
});
