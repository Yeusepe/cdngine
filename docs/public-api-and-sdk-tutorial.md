# Public API and TypeScript SDK Tutorial

This guide is for normal application developers.

CDNgine is a file service for your app.

Most apps use it for two jobs:

1. upload a file
2. get a download URL for a file

## What you need to understand first

You do **not** need every CDNgine term for every flow.

### Uploads need to know where a new file belongs

That usually means:

- `serviceNamespaceId`
- `assetOwner`
- maybe `tenantId`

### Downloads need to know which existing file you want

That usually means:

- `assetId`
- `versionId`
- either a delivery scope + variant, or the source-download helper

## What the words mean

| Word | Plain meaning |
| --- | --- |
| `serviceNamespaceId` | A label for the app area using CDNgine. Example: `media` or `course-files`. |
| `tenantId` | The customer, workspace, or organization the file belongs to. |
| `assetOwner` | Who owns the file in your product. Example: `user:123`. |
| `assetId` | The file ID. |
| `versionId` | The version of that file. |
| `deliveryScopeId` | The download rule to use. Example: `public-images` or `paid-downloads`. |
| `variant` | Which generated file you want. Example: thumbnail, web image, PDF. |

## What is a namespace?

A **namespace** is just a label for the part of your app using CDNgine.

Examples:

- `media`
- `course-files`
- `store-downloads`

It is **not**:

- the user
- the customer
- the file ID

Most apps pick one namespace and mostly forget about it.

## Which values do I need?

| Job | Usually required |
| --- | --- |
| Upload a file | `serviceNamespaceId`, `assetOwner`, file bytes |
| Upload in a multi-tenant app | `serviceNamespaceId`, `assetOwner`, `tenantId`, file bytes |
| Download a generated file | `assetId`, `versionId`, `deliveryScopeId`, `variant` |
| Download the original uploaded file | `assetId`, `versionId` |

## Which SDK method should I use?

| Goal | Use this |
| --- | --- |
| Upload and wait until the file is ready | `client.withDefaults(...).upload(file, ...)` |
| Upload but do not wait | `client.withDefaults(...).uploadFile(file, ...)` |
| Download a generated file | `client.asset(assetId).version(versionId).delivery(scope).url(...)` |
| Download the original uploaded file | `client.asset(assetId).version(versionId).source().url(...)` |
| You need the full auth response instead of just a URL | use `.authorize(...)` instead of `.url(...)` |

## Examples that make it click

The names in these examples are just examples.

- `media`
- `paid-downloads`
- `webp-master`
- `thumbnail`

Your app can use different names.

### Example 1: profile photo upload

You have a normal app. A signed-in user uploads a profile photo.

Use:

- `serviceNamespaceId`: `media`
- `assetOwner`: `user:123`
- no `tenantId`

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

### Example 2: team file upload in a multi-tenant app

You have organizations or workspaces. A user uploads a file inside the `acme` workspace.

Use:

- `serviceNamespaceId`: `media`
- `tenantId`: `acme`
- `assetOwner`: `organization:acme`

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

### Example 3: show an image on a page

You already have `assetId` and `versionId`.
You want a generated web image URL.

Use:

- `delivery(...)`
- a scope like `public-images`
- a variant like `webp-master`

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

### Example 4: download the original uploaded file

You do **not** want a generated file.
You want the exact original upload.

Use:

- `source().url(...)`

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

### Example 5: sell a downloadable file

Your app decides the user bought the file.
Then you ask CDNgine for a short-lived download URL.

Use:

- `delivery('paid-downloads')`
- a variant that represents the downloadable file you want

```ts
const downloadUrl = await client
  .asset(assetId)
  .version(versionId)
  .delivery('paid-downloads')
  .url({
    variant: 'download-pdf',
    idempotencyKey: `download-${versionId}`
  });

window.location.assign(downloadUrl);
```

### Example 6: the same file, different outputs

One uploaded file can give you different generated files.

```ts
const version = client.asset(assetId).version(versionId);

const thumbnailUrl = await version.delivery('public-images').url({
  variant: 'thumbnail',
  idempotencyKey: `thumb-${versionId}`
});

const fullImageUrl = await version.delivery('public-images').url({
  variant: 'webp-master',
  idempotencyKey: `full-${versionId}`
});

const originalUrl = await version.source().url({
  preferredDisposition: 'attachment',
  idempotencyKey: `original-${versionId}`
});
```

That is the main difference:

- `delivery(...).url(...)` = generated file
- `source().url(...)` = original uploaded file

## Smallest upload example

Use this when you want the normal app flow: upload a file and wait until it is ready.

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

### What to change

- `baseUrl`: your API URL
- `getAccessToken`: how your app gets the current user's token
- `serviceNamespaceId`: one fixed label for your app area
- `assetOwner`: who owns the file in your product
- `tenantId`: only if your app is multi-tenant

## Smallest generated-download example

Use this when you want a generated file, such as an image variant or a paid downloadable file.

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
    idempotencyKey: `download-${versionId}`
  });

window.location.assign(url);
```

### What to change

- `assetId`: the file you want
- `versionId`: the version of that file
- `delivery('paid-downloads')`: the download rule you want to use
- `variant`: which generated file to return

### What is not needed here

You usually do **not** need:

- `serviceNamespaceId`
- `tenantId`
- `assetOwner`

Those matter when the file is created, not when you download an existing file.

## Smallest original-download example

Use this when you want the exact original uploaded file, not a generated version.

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

## When should I use what?

### Use `withDefaults(...)` when:

- you are uploading files
- the same upload values repeat over and over

### Use `delivery(...).url(...)` when:

- you want a generated file
- you know which output you want, such as a thumbnail or paid download

### Use `source().url(...)` when:

- you want the original uploaded file

### Use `assetOwner` when:

- you are uploading a new file
- you need to say who owns that file in your product

Examples:

- `user:123`
- `organization:acme`
- `course:456`

### Use `tenantId` when:

- your app has separate customers, workspaces, or organizations
- the file belongs to one of them

If your app is not multi-tenant, you usually do not need `tenantId`.

## How multi-tenant downloads work

Your app still decides whether the signed-in user is allowed to download the file.

CDNgine does **not** replace your product's business rules.

The normal flow is:

1. your app signs the user in
2. your app decides whether they are allowed to download the file
3. the SDK asks CDNgine for a short-lived download URL
4. your app sends the browser to that URL

## The one thing people usually get wrong

They assume uploads and downloads need the same setup values.

They do not.

- uploads need to know where a new file belongs
- downloads need to know which existing file to fetch

## Raw HTTP reference

If you are building another SDK or debugging the API directly, the wire-level flow is:

1. `POST /v1/upload-sessions`
2. upload bytes to the returned tus URL
3. `POST /v1/upload-sessions/{uploadSessionId}/complete`
4. `GET /v1/assets/{assetId}/versions/{versionId}` until ready
5. `POST /v1/assets/{assetId}/versions/{versionId}/deliveries/{deliveryScopeId}/authorize` for generated files
6. `POST /v1/assets/{assetId}/versions/{versionId}/source/authorize` for the original file

Most app developers should start with the SDK examples above, not the raw HTTP flow.

## Current reality of this repository

Be realistic about what is here today:

1. the SDK is a workspace package in this monorepo
2. your host app is still responsible for authentication
3. your host app still decides who is allowed to download what

## Read next

- [`@cdngine/sdk` README](../packages/sdk/README.md)
- [API Surface](./api-surface.md)
- [Security Model](./security-model.md)
