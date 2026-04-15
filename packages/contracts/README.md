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
import { createCDNgineClient } from '@cdngine/contracts';

const client = createCDNgineClient({
  baseUrl: 'https://api.cdngine.local',
  getAccessToken: () => process.env.CDNGINE_TOKEN
});

const uploaded = await client.assets.uploadAndWait({
  create: {
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
  },
  complete: {
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

## Governing docs

- `docs/sdk-strategy.md`
- `docs/spec-governance.md`
- `docs/api-surface.md`
