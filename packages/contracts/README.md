# `@cdngine/contracts`

Checked-in contract and SDK package for the public CDNgine API.

## What is here

- generated public OpenAPI TypeScript types in `src/generated/public-api.ts`
- `CDNginePublicClient` in `src/public-client.ts`
- repo-level generation and freshness checks:
  - `npm run sdk:generate`
  - `npm run sdk:check`

## Example

```ts
import { CDNginePublicClient } from '@cdngine/contracts';

const client = new CDNginePublicClient({
  baseUrl: 'https://api.cdngine.local',
  getAccessToken: () => process.env.CDNGINE_TOKEN
});

const session = await client.createUploadSession({
  idempotencyKey: 'upload-001',
  body: {
    serviceNamespaceId: 'media-platform',
    assetOwner: 'customer:acme',
    source: {
      filename: 'hero-banner.png',
      contentType: 'image/png'
    },
    upload: {
      objectKey: 'uploads/hero-banner.png',
      byteLength: 1843921,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      }
    }
  }
});

const completed = await client.completeUploadSession({
  uploadSessionId: session.uploadSessionId,
  idempotencyKey: 'complete-001',
  body: {
    stagedObject: {
      objectKey: 'uploads/hero-banner.png',
      byteLength: 1843921,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      }
    }
  }
});

const version = await client.waitForVersion(completed.assetId, completed.versionId);
```

## Governing docs

- `docs/sdk-strategy.md`
- `docs/spec-governance.md`
- `docs/api-surface.md`
