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

const uploaded = await client.assets.uploadFileAndWait({
  assetOwner: 'customer:acme',
  contentType: 'image/png',
  file: fileBuffer,
  filename: 'hero-banner.png',
  idempotencyKey: 'hero-banner-v1',
  serviceNamespaceId: 'media-platform',
  tenantId: 'tenant-acme',
  wait: {
    untilStates: ['published']
  }
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

## Low-level upload helpers still exist

`assets.upload(...)` and `assets.uploadAndWait(...)` are still available, but they are now the lower-level path for pre-staged or custom-ingest flows.

For normal application code, prefer:

- `client.assets.uploadFile(...)`
- `client.assets.uploadFileAndWait(...)`

Use the lower-level helpers only when another layer already uploaded the bytes or when you are deliberately controlling the staging flow yourself.

## Step-by-step tutorial

For the SDK-first tutorial plus the raw HTTP reference flow, read [Public API And TypeScript SDK Tutorial](../../docs/public-api-and-sdk-tutorial.md).

## Governing docs

- `docs/sdk-strategy.md`
- `docs/spec-governance.md`
- `docs/api-surface.md`
- `docs/public-api-and-sdk-tutorial.md`
