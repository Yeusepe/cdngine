# `@cdngine/sdk`

TypeScript SDK for the public CDNgine API.

## Start here

Most app developers only need this SDK for two jobs:

1. upload a file
2. get a download URL for a file

## What the words mean

| Word | Plain meaning |
| --- | --- |
| `serviceNamespaceId` | A label for the app area using CDNgine. Example: `media`. |
| `tenantId` | The customer, workspace, or organization the file belongs to. |
| `assetOwner` | Who owns the file in your product. Example: `user:123`. |
| `assetId` | The file ID. |
| `versionId` | The version of that file. |
| `deliveryScopeId` | The download rule to use. Example: `paid-downloads`. |
| `variant` | Which generated file you want. |

## What is a namespace?

A **namespace** is just a label for the app area using CDNgine.

Examples:

- `media`
- `course-files`
- `store-downloads`

Most apps pick one namespace and mostly forget about it.

## Which values do I need?

| Job | Usually required |
| --- | --- |
| Upload a file | `serviceNamespaceId`, `assetOwner`, file bytes |
| Upload in a multi-tenant app | `serviceNamespaceId`, `assetOwner`, `tenantId`, file bytes |
| Download a generated file | `assetId`, `versionId`, `deliveryScopeId`, `variant` |
| Download the original uploaded file | `assetId`, `versionId` |

## Examples that make it click

### Profile photo upload

```ts
const files = client.withDefaults({
  serviceNamespaceId: 'media',
  assetOwner: 'user:123',
  wait: {
    untilStates: ['published']
  }
});

const result = await files.upload(file, {
  filename: file.name,
  contentType: file.type
});
```

### Workspace file upload

```ts
const files = client.withDefaults({
  serviceNamespaceId: 'media',
  tenantId: 'acme',
  assetOwner: 'organization:acme',
  wait: {
    untilStates: ['published']
  }
});

const result = await files.upload(file, {
  filename: file.name,
  contentType: file.type
});
```

### Generated image download

```ts
const imageUrl = await client
  .asset(assetId)
  .version(versionId)
  .delivery('public-images')
  .url({
    variant: 'webp-master',
    idempotencyKey: `image-${versionId}`
  });
```

### Original file download

```ts
const sourceUrl = await client
  .asset(assetId)
  .version(versionId)
  .source()
  .url({
    preferredDisposition: 'attachment',
    idempotencyKey: `source-${versionId}`
  });
```

### Paid download

```ts
const downloadUrl = await client
  .asset(assetId)
  .version(versionId)
  .delivery('paid-downloads')
  .url({
    variant: 'download-pdf',
    oneTime: true,
    idempotencyKey: `download-${versionId}`
  });
```

Use `oneTime: true` when you want a link that works once and then becomes invalid.

## Smallest upload example

```ts
import { createCDNgineClient } from '@cdngine/sdk';

const client = createCDNgineClient({
  baseUrl: 'https://api.example.com',
  getAccessToken: () => accessToken
});

const files = client.withDefaults({
  serviceNamespaceId: 'media',
  assetOwner: 'user:123',
  tenantId: 'acme', // only if your app is multi-tenant
  wait: {
    untilStates: ['published']
  }
});

const result = await files.upload(file, {
  filename: file.name,
  contentType: file.type || 'application/octet-stream',
  idempotencyKey: `upload-${file.name}-${file.size}`
});
```

Use `withDefaults(...)` for uploads because uploads usually repeat the same setup values.

## Smallest generated-download example

```ts
import { createCDNgineClient } from '@cdngine/sdk';

const client = createCDNgineClient({
  baseUrl: 'https://api.example.com',
  getAccessToken: () => accessToken
});

const url = await client
  .asset(assetId)
  .version(versionId)
  .delivery('paid-downloads')
  .url({
    variant: 'webp-master',
    oneTime: true,
    idempotencyKey: `download-${versionId}`
  });

window.location.assign(url);
```

Downloads usually do **not** need:

- `serviceNamespaceId`
- `tenantId`
- `assetOwner`

Those matter when the file is created, not when you download an existing file.

## Smallest original-download example

```ts
import { createCDNgineClient } from '@cdngine/sdk';

const client = createCDNgineClient({
  baseUrl: 'https://api.example.com',
  getAccessToken: () => accessToken
});

const url = await client
  .asset(assetId)
  .version(versionId)
  .source()
  .url({
    preferredDisposition: 'attachment',
    idempotencyKey: `source-${versionId}`
  });

window.location.assign(url);
```

## Which method should I use?

| Goal | Use this |
| --- | --- |
| Upload and wait until ready | `client.withDefaults(...).upload(file, ...)` |
| Upload but do not wait | `client.withDefaults(...).uploadFile(file, ...)` |
| Download a generated file | `client.asset(assetId).version(versionId).delivery(scope).url(...)` |
| Download the original file | `client.asset(assetId).version(versionId).source().url(...)` |
| You need the full auth response, not just a URL | use `.authorize(...)` instead of `.url(...)` |

## What this package wraps

The checked-in client wraps:

- asset reads
- upload-session creation and completion
- file upload orchestration
- version reads and waiting
- derivative listing
- manifest fetch
- generated-file authorization
- original-file authorization

## Current limit

This package is a workspace package in this monorepo today. It is not yet published as a standalone npm package.

## Read more

For the longer walkthrough, read [Public API and TypeScript SDK Tutorial](../../docs/public-api-and-sdk-tutorial.md).
