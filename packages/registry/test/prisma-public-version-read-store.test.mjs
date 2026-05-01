/**
 * Purpose: Verifies durable public-read authorization idempotency for CDN delivery and source grants.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/idempotency-and-dispatch.md
 * - docs/persistence-model.md
 * - docs/storage-tiering-and-materialization.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * - https://www.rfc-editor.org/rfc/rfc9111
 * Tests:
 * - packages/registry/test/prisma-public-version-read-store.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PrismaPublicVersionReadStore,
  RegistryPublicReadIdempotencyConflictError
} from '../dist/index.js';
import { withRegistryTestDatabase } from './prisma-test-helpers.mjs';

async function seedPublishedAsset(prisma, scope) {
  const serviceNamespaceId = `gumroad-prod-${scope}`;
  const tenantId = `creator-${scope}`;
  const namespace = await prisma.serviceNamespace.create({
    data: {
      displayName: 'Gumroad Production',
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
      cacheProfile: 'immutable-package',
      deliveryMode: 'shared-path',
      hostname: 'packages.gumroad-cdn.test',
      pathPrefix: 'backstage',
      scopeKey: `backstage-packages-${scope}`,
      serviceNamespaceId: namespace.id,
      tenantScopeId: tenant.id
    }
  });
  const asset = await prisma.asset.create({
    data: {
      assetOwner: `creator:${tenantId}`,
      lookupKey: `com.yucp.creator-package-${scope}`,
      serviceNamespaceId: namespace.id,
      tenantScopeId: tenant.id
    }
  });
  const version = await prisma.assetVersion.create({
    data: {
      assetId: asset.id,
      canonicalDigestSet: [{ algorithm: 'sha256', value: 'source-sha' }],
      canonicalLogicalPath: `source/${serviceNamespaceId}/${asset.id}/v1/original/package.zip`,
      canonicalSnapshotId: `snap-${scope}`,
      canonicalSourceId: `src-${scope}`,
      detectedContentType: 'application/zip',
      lifecycleState: 'published',
      repositoryEngine: 'xet',
      sourceByteLength: 4096n,
      sourceChecksumAlgorithm: 'sha256',
      sourceChecksumValue: 'source-sha',
      sourceFilename: 'package.zip',
      versionNumber: 1
    }
  });

  await prisma.derivative.createMany({
    data: [
      {
        assetVersionId: version.id,
        byteLength: 4096n,
        contentType: 'application/zip',
        deliveryScopeId: deliveryScope.id,
        deterministicKey: `deriv/${serviceNamespaceId}/${asset.id}/${version.id}/preserve-original`,
        publicationState: 'published',
        recipeId: 'preserve-original',
        schemaVersion: 'v1',
        storageKey: `packages/${asset.id}/${version.id}/package.zip`,
        variantKey: 'preserve-original'
      },
      {
        assetVersionId: version.id,
        byteLength: 1024n,
        contentType: 'application/json',
        deliveryScopeId: deliveryScope.id,
        deterministicKey: `deriv/${serviceNamespaceId}/${asset.id}/${version.id}/manifest`,
        publicationState: 'published',
        recipeId: 'manifest',
        schemaVersion: 'v1',
        storageKey: `packages/${asset.id}/${version.id}/manifest.json`,
        variantKey: 'manifest'
      }
    ]
  });

  return {
    assetId: asset.id,
    deliveryScopeId: deliveryScope.id,
    versionId: version.id
  };
}

test('Prisma public-read delivery authorization replays one-time grants by idempotency key', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const seeded = await seedPublishedAsset(prisma, schema);
    const store = new PrismaPublicVersionReadStore({ prisma });
    const request = {
      callerScopeKey: `public:buyer-${schema}`,
      idempotencyKey: `delivery-idem-${schema}`,
      now,
      oneTime: true
    };

    const first = await store.authorizeDelivery(
      seeded.assetId,
      seeded.versionId,
      seeded.deliveryScopeId,
      'preserve-original',
      request
    );
    const second = await store.authorizeDelivery(
      seeded.assetId,
      seeded.versionId,
      seeded.deliveryScopeId,
      'preserve-original',
      request
    );

    assert.equal(first.url, second.url);
    assert.match(first.url, /^\/download-links\//u);
    assert.equal(
      await prisma.deliveryAuthorizationAudit.count({
        where: { actorScopeKey: request.callerScopeKey, authorizationFamily: 'delivery' }
      }),
      1
    );
    assert.equal(
      await prisma.idempotencyRecord.count({
        where: { callerScopeKey: request.callerScopeKey, idempotencyKey: request.idempotencyKey }
      }),
      1
    );
  });
});

test('Prisma public-read delivery authorization rejects same-key semantic drift', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const seeded = await seedPublishedAsset(prisma, schema);
    const store = new PrismaPublicVersionReadStore({ prisma });
    const request = {
      callerScopeKey: `public:buyer-${schema}`,
      idempotencyKey: `delivery-conflict-${schema}`,
      now,
      oneTime: true
    };

    await store.authorizeDelivery(
      seeded.assetId,
      seeded.versionId,
      seeded.deliveryScopeId,
      'preserve-original',
      request
    );

    await assert.rejects(
      () =>
        store.authorizeDelivery(
          seeded.assetId,
          seeded.versionId,
          seeded.deliveryScopeId,
          'manifest',
          request
        ),
      RegistryPublicReadIdempotencyConflictError
    );
  });
});

test('Prisma public-read source authorization replays source grants by idempotency key', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const seeded = await seedPublishedAsset(prisma, schema);
    const store = new PrismaPublicVersionReadStore({ prisma });
    const request = {
      callerScopeKey: `public:buyer-${schema}`,
      idempotencyKey: `source-idem-${schema}`,
      now,
      oneTime: true
    };

    const first = await store.authorizeSource(
      seeded.assetId,
      seeded.versionId,
      'attachment',
      request
    );
    const second = await store.authorizeSource(
      seeded.assetId,
      seeded.versionId,
      'attachment',
      request
    );

    assert.equal(first.url, second.url);
    assert.match(first.url, /^\/download-links\//u);
    assert.equal(
      await prisma.sourceAccessGrant.count({ where: { actorScopeKey: request.callerScopeKey } }),
      1
    );
    assert.equal(
      await prisma.deliveryAuthorizationAudit.count({
        where: { actorScopeKey: request.callerScopeKey, authorizationFamily: 'source' }
      }),
      1
    );
  });
});

test('Prisma public-read source authorization rejects same-key semantic drift', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const seeded = await seedPublishedAsset(prisma, schema);
    const store = new PrismaPublicVersionReadStore({ prisma });
    const request = {
      callerScopeKey: `public:buyer-${schema}`,
      idempotencyKey: `source-conflict-${schema}`,
      now,
      oneTime: true
    };

    await store.authorizeSource(seeded.assetId, seeded.versionId, 'attachment', request);

    await assert.rejects(
      () => store.authorizeSource(seeded.assetId, seeded.versionId, 'inline', request),
      RegistryPublicReadIdempotencyConflictError
    );
  });
});
