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

// createCDNgineClient(...) builds the root SDK client for your app.
const client = createCDNgineClient({
  // baseUrl points at the host app that mounted the CDNgine public API.
  baseUrl: 'https://api.cdngine.local',
  // getAccessToken supplies the bearer token CDNgine should send on requests.
  getAccessToken: () => process.env.CDNGINE_TOKEN
});

// withDefaults(...) creates a scoped client so you do not repeat the same
// namespace, tenant, owner, and wait settings on every call.
const media = client.withDefaults({
  // assetOwner is the caller-facing owner persisted for policy and audit.
  assetOwner: 'customer:acme',
  // serviceNamespaceId selects the registered CDNgine namespace.
  serviceNamespaceId: 'media-platform',
  // tenantId applies tenant isolation inside that namespace.
  tenantId: 'tenant-acme',
  wait: {
    // untilStates defines which lifecycle states count as "ready".
    untilStates: ['published']
  }
});

// upload(...) is the shortest high-level helper for "upload this file and wait".
const uploaded = await media.upload(fileBuffer, {
  // contentType records the media type of the uploaded file.
  contentType: 'image/png',
  // filename sets the persisted source file name.
  filename: 'hero-banner.png',
  // idempotencyKey makes retries converge on one logical upload.
  idempotencyKey: 'hero-banner-v1'
});

// asset(...).version(...) targets one immutable version.
// delivery('public-images') selects the delivery policy.
// authorize(...) returns the full authorization payload.
const delivery = await client
  .asset(uploaded.assetId)
  .version(uploaded.versionId)
  .delivery('public-images')
  .authorize({
    // idempotencyKey makes repeated authorization attempts safe.
    idempotencyKey: `delivery-${uploaded.versionId}`,
    body: {
      // responseFormat='url' asks for a redirectable URL response.
      responseFormat: 'url',
      // variant chooses which published derivative you want.
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
// createCDNgineClient(...) builds the root browser SDK client.
const client = createCDNgineClient({
  // baseUrl points at your mounted public API.
  baseUrl: 'https://api.cdngine.local',
  // getAccessToken reads the current signed-in user's bearer token.
  getAccessToken: () => sessionStorage.getItem('access_token') ?? undefined
});

// withDefaults(...) binds the namespace and tenant once for later download calls.
const downloads = client.withDefaults({
  serviceNamespaceId: 'media-platform',
  tenantId: 'tenant-acme'
});

// asset(...).version(...) targets the exact immutable version.
// delivery('paid-downloads') selects the paid-download policy.
// url(...) is the shorthand helper that returns only the final redirect URL.
const url = await downloads.asset('ast_001').version('ver_001').delivery('paid-downloads').url({
  // idempotencyKey makes repeated clicks or retries safe.
  idempotencyKey: 'download-ver_001-user_123',
  // variant chooses which published output the user should receive.
  variant: 'webp-master'
});

// Redirect the browser to the short-lived authorized download URL.
window.location.assign(url);
```

Original-source download example:

```ts
// asset(...).version(...) targets the exact immutable version.
// source().url(...) is the shorthand helper for the original uploaded file.
const url = await client.asset('ast_001').version('ver_001').source().url({
  // idempotencyKey makes retries safe.
  idempotencyKey: 'source-ver_001-user_123',
  // preferredDisposition='attachment' tells the browser to download the file.
  preferredDisposition: 'attachment'
});

// Redirect the browser to the short-lived authorized source-download URL.
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
