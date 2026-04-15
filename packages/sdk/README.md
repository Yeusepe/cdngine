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

- upload-session creation
- upload-session completion
- version reads and polling
- derivative listing
- manifest fetch
- derivative delivery authorization
- original-source authorization

Be realistic about the current limits:

1. this package is a private workspace package today, not a published npm package
2. it does **not** upload file bytes to the returned tus target for you
3. it does **not** currently wrap `GET /v1/assets/{assetId}`

## Real upload flow

```ts
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { createCDNgineClient } from '@cdngine/sdk';

const filePath = './hero-banner.png';
const fileBuffer = await readFile(filePath);
const fileSize = (await stat(filePath)).size;
const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex');
const objectKey = 'staging/media-platform/tenant-acme/hero-banner.png';

const client = createCDNgineClient({
  baseUrl: 'https://api.cdngine.local',
  getAccessToken: () => process.env.CDNGINE_TOKEN
});

const session = await client.createUploadSession({
  idempotencyKey: `create-${fileSha256}`,
  body: {
    serviceNamespaceId: 'media-platform',
    tenantId: 'tenant-acme',
    assetOwner: 'customer:acme',
    source: {
      filename: 'hero-banner.png',
      contentType: 'image/png'
    },
    upload: {
      objectKey,
      byteLength: fileSize,
      checksum: {
        algorithm: 'sha256',
        value: fileSha256
      }
    }
  }
});

await fetch(session.uploadTarget.url, {
  method: session.uploadTarget.method,
  headers: {
    'Tus-Resumable': '1.0.0',
    'Upload-Offset': '0',
    'Content-Type': 'application/offset+octet-stream'
  },
  body: fileBuffer
});

const completion = await client.completeUploadSession({
  uploadSessionId: session.uploadSessionId,
  idempotencyKey: `complete-${session.uploadSessionId}`,
  body: {
    stagedObject: {
      objectKey,
      byteLength: fileSize,
      checksum: {
        algorithm: 'sha256',
        value: fileSha256
      }
    }
  }
});

const version = await client
  .asset(completion.assetId)
  .version(completion.versionId)
  .wait({
    untilStates: ['published']
  });

const delivery = await client
  .asset(completion.assetId)
  .version(completion.versionId)
  .delivery('public-images')
  .authorize({
    idempotencyKey: `delivery-${completion.versionId}`,
    body: {
      responseFormat: 'url',
      variant: 'webp-master'
    }
  });

console.log(version.lifecycleState, delivery.url);
```

## Important note about `assets.upload(...)` and `assets.uploadAndWait(...)`

Those helpers currently orchestrate:

1. `createUploadSession(...)`
2. `completeUploadSession(...)`
3. optional `waitForVersion(...)`

They do **not** push the binary to the returned tus upload URL. Use them only when the staging step is already handled elsewhere, such as:

- tests
- demos
- pre-staged ingest environments
- a higher-level wrapper that already uploaded the bytes

## Step-by-step tutorial

For a realistic tutorial that covers:

- raw HTTP usage
- the real Better Auth bearer-token requirement
- the tus upload step
- the current TypeScript client surface
- current gaps such as missing `getAsset(...)`

read [Public API And TypeScript SDK Tutorial](../../docs/public-api-and-sdk-tutorial.md).

## Governing docs

- `docs/sdk-strategy.md`
- `docs/spec-governance.md`
- `docs/api-surface.md`
- `docs/public-api-and-sdk-tutorial.md`
