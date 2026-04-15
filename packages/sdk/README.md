# `@cdngine/sdk`

Checked-in contract and SDK package for the public CDNgine API.

## What is here

- generated public OpenAPI TypeScript types in `src/generated/public-api.ts`
- `CDNginePublicClient` in `src/public-client.ts`
- grouped helpers such as `client.assets.*` and fluent version handles such as `client.asset(assetId).version(versionId)`
- repo-level generation and freshness checks:
  - `npm run sdk:generate`
  - `npm run sdk:check`

## Current scope

The checked-in client wraps the public control-plane calls for:

- logical-asset reads
- upload-session creation
- upload-session completion
- full file and byte upload orchestration
- version reads and polling
- derivative listing
- manifest fetch
- derivative delivery authorization
- original-source authorization

Be realistic about the current limits:

1. this package is a private workspace package today, not a published npm package

## Real upload flow

```ts
import { readFile } from 'node:fs/promises';

import { createCDNgineClient } from '@cdngine/sdk';

const filePath = './hero-banner.png';
const fileBuffer = await readFile(filePath);

const client = createCDNgineClient({
  baseUrl: 'https://api.cdngine.local',
  getAccessToken: () => process.env.CDNGINE_TOKEN
});

const media = client.withDefaults({
  assetOwner: 'customer:acme',
  serviceNamespaceId: 'media-platform',
  tenantId: 'tenant-acme',
  wait: {
    untilStates: ['published']
  }
});

const uploaded = await media.upload(fileBuffer, {
  contentType: 'image/png',
  filename: 'hero-banner.png',
  idempotencyKey: 'hero-banner-v1'
});

const delivery = await client
  .asset(uploaded.assetId)
  .version(uploaded.versionId)
  .delivery('public-images')
  .authorize({
    idempotencyKey: `delivery-${uploaded.versionId}`,
    body: {
      responseFormat: 'url',
      variant: 'webp-master'
    }
  });

console.log(uploaded.version.lifecycleState, delivery.url);
```

## Private multi-tenant downloads

If you are selling files to authenticated users, the normal pattern is:

1. your host app authenticates the user and checks the business entitlement
2. the caller's token resolves to a CDNgine actor with the correct tenant and namespace scope
3. the SDK asks CDNgine for a short-lived authorized URL
4. your UI redirects the user to that URL

Derivative download example:

```ts
const client = createCDNgineClient({
  baseUrl: 'https://api.cdngine.local',
  getAccessToken: () => sessionStorage.getItem('access_token') ?? undefined
});

const downloads = client.withDefaults({
  serviceNamespaceId: 'media-platform',
  tenantId: 'tenant-acme'
});

const url = await downloads.asset('ast_001').version('ver_001').delivery('paid-downloads').url({
  idempotencyKey: 'download-ver_001-user_123',
  variant: 'webp-master'
});

window.location.assign(url);
```

Original-source download example:

```ts
const url = await client.asset('ast_001').version('ver_001').source().url({
  idempotencyKey: 'source-ver_001-user_123',
  preferredDisposition: 'attachment'
});

window.location.assign(url);
```

Use CDNgine's authorize step as the product download boundary. Do not expose the raw origin object URL directly as your customer-facing download link.

## Low-level upload helpers still exist

`client.withDefaults(...)` and `client.scope(...)` are the shortest path for normal application code because they let you bind namespace, tenant, owner, and default wait behavior once.

Then prefer:

- `scopedClient.upload(...)`
- `scopedClient.uploadFile(...)`

Under that, `client.assets.uploadFile(...)` and `client.assets.uploadFileAndWait(...)` are still available when you want the explicit all-options object shape.

Use the lower-level `assets.upload(...)` and `assets.uploadAndWait(...)` helpers only when another layer already uploaded the bytes or when you are deliberately controlling the staging flow yourself.

## Step-by-step tutorial

For the SDK-first tutorial plus the raw HTTP reference flow, read [Public API And TypeScript SDK Tutorial](../../docs/public-api-and-sdk-tutorial.md).

## Governing docs

- `docs/sdk-strategy.md`
- `docs/spec-governance.md`
- `docs/api-surface.md`
- `docs/public-api-and-sdk-tutorial.md`
