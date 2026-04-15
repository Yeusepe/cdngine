# Public API and TypeScript SDK Tutorial

This file documents:

1. the **SDK-first** integration path for normal application code
2. the real public HTTP flow as a wire-level reference
3. the places where you still need your own host app and auth flow

## Governing docs

- `docs/api-surface.md`
- `docs/sdk-strategy.md`
- `docs/service-architecture.md`
- `docs/security-model.md`
- `packages/sdk/README.md`

## External references

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload)
- [RFC 6750: OAuth 2.0 Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
- [RFC 8725: JWT Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)

## Before you start

You need these values regardless of whether you call the API directly or use the TypeScript client:

- `API_BASE_URL`: the host where your application mounted the CDNgine public API
- `ACCESS_TOKEN`: a bearer token accepted by that host's CDNgine auth integration
- `serviceNamespaceId`: the CDNgine service namespace you are allowed to use
- `tenantId`: required when your namespace is tenant-scoped
- `assetOwner`: the caller-facing owner string used for policy
- a file, blob, or byte buffer to upload

If you are dropping to raw HTTP instead of the SDK, you also need:

- `objectKey`: the staging object key your upload will use
- `byteLength` and `sha256` checksum for the file you are uploading

If you are using the repository as-is for local exploration, keep these constraints in mind:

1. `npm start` brings up the dependency stack, not a standalone public API server
2. `npm run start:demo` starts the demo, which shows the flow, but the demo is not a generic auth portal
3. the public API is currently exercised through tests, demo generation, and host-app embedding rather than through a checked-in standalone server binary

## Step by step: raw HTTP API

Use this only when you explicitly want wire-level control, need to debug the public contract, or are building another SDK.

The examples below use Bash and `curl` because that makes the wire contract explicit. The same sequence applies from any language.

### 1. Prepare file metadata

```bash
API_BASE_URL="https://api.cdngine.local"
ACCESS_TOKEN="replace-with-host-access-token"

SERVICE_NAMESPACE_ID="media-platform"
TENANT_ID="tenant-acme"
ASSET_OWNER="customer:acme"

FILE="./hero-banner.png"
FILE_NAME="$(basename "$FILE")"
FILE_SIZE="$(wc -c < "$FILE" | tr -d ' ')"
FILE_SHA256="$(sha256sum "$FILE" | awk '{print $1}')"
OBJECT_KEY="staging/${SERVICE_NAMESPACE_ID}/${TENANT_ID}/${FILE_NAME}"
```

If you are on macOS, replace `sha256sum` with `shasum -a 256`.

### 2. Create the upload session

```bash
CREATE_RESPONSE="$(
  curl -sS -X POST "$API_BASE_URL/v1/upload-sessions" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: create-$FILE_SHA256" \
    -d "{
      \"serviceNamespaceId\": \"$SERVICE_NAMESPACE_ID\",
      \"tenantId\": \"$TENANT_ID\",
      \"assetOwner\": \"$ASSET_OWNER\",
      \"source\": {
        \"filename\": \"$FILE_NAME\",
        \"contentType\": \"image/png\"
      },
      \"upload\": {
        \"objectKey\": \"$OBJECT_KEY\",
        \"byteLength\": $FILE_SIZE,
        \"checksum\": {
          \"algorithm\": \"sha256\",
          \"value\": \"$FILE_SHA256\"
        }
      }
    }"
)"

printf '%s\n' "$CREATE_RESPONSE"
```

A successful response gives you:

- `uploadSessionId`
- `assetId`
- `versionId`
- `uploadTarget.protocol`
- `uploadTarget.method`
- `uploadTarget.url`

For the rest of this example, copy those values out of the JSON response.

### 3. Upload the file bytes to the returned tus target

The public API does **not** accept the file bytes directly. It gives you a tus upload target and expects you to send the binary there.

```bash
UPLOAD_URL="replace-with-uploadTarget.url"

curl -sS -X PATCH "$UPLOAD_URL" \
  -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Offset: 0" \
  -H "Content-Type: application/offset+octet-stream" \
  --data-binary @"$FILE"
```

This manual tus step exists only because this section is showing the raw HTTP contract directly. In normal application code, prefer `client.assets.uploadFile(...)` or `client.assets.uploadFileAndWait(...)`, which perform this upload step for you.

### 4. Complete the upload session

```bash
UPLOAD_SESSION_ID="replace-with-uploadSessionId"
ASSET_ID="replace-with-assetId"
VERSION_ID="replace-with-versionId"

COMPLETE_RESPONSE="$(
  curl -sS -X POST "$API_BASE_URL/v1/upload-sessions/$UPLOAD_SESSION_ID/complete" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: complete-$UPLOAD_SESSION_ID" \
    -d "{
      \"stagedObject\": {
        \"objectKey\": \"$OBJECT_KEY\",
        \"byteLength\": $FILE_SIZE,
        \"checksum\": {
          \"algorithm\": \"sha256\",
          \"value\": \"$FILE_SHA256\"
        }
      }
    }"
)"

printf '%s\n' "$COMPLETE_RESPONSE"
```

Successful completion returns `202 Accepted` and gives you:

- the immutable `assetId` and `versionId`
- `versionState`
- `workflowDispatch.state`
- a link to `GET /v1/assets/{assetId}/versions/{versionId}`

That response means canonicalization has been accepted. It does **not** mean derivatives are already published.

### 5. Poll the version until it reaches a usable lifecycle state

```bash
curl -sS "$API_BASE_URL/v1/assets/$ASSET_ID/versions/$VERSION_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Watch `lifecycleState` and `workflowState`.

In the current client wrapper, the default terminal states for waiting are:

- `canonical`
- `published`
- `quarantined`

If you need published derivatives, keep polling until `lifecycleState` becomes `published`.

### 6. List derivatives

```bash
curl -sS "$API_BASE_URL/v1/assets/$ASSET_ID/versions/$VERSION_ID/derivatives" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

This returns the deterministic derivative set for the version after publication.

### 7. Fetch the manifest

```bash
curl -sS "$API_BASE_URL/v1/assets/$ASSET_ID/versions/$VERSION_ID/manifests/image-default" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

For presentation workloads, the manifest type is usually `presentation-default`.

### 8. Authorize derivative delivery

```bash
curl -sS -X POST \
  "$API_BASE_URL/v1/assets/$ASSET_ID/versions/$VERSION_ID/deliveries/public-images/authorize" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: delivery-$VERSION_ID" \
  -d '{
    "variant": "webp-master",
    "responseFormat": "url"
  }'
```

Current delivery authorization responses include fields such as:

- `authorizationMode`
- `resolvedOrigin`
- `url`
- `expiresAt`

The important part is that the client asks CDNgine for one delivery authorization response and does **not** need to decide whether the result came from CDN, origin, or another internal path.

### 9. Authorize original-source download

```bash
curl -sS -X POST \
  "$API_BASE_URL/v1/assets/$ASSET_ID/versions/$VERSION_ID/source/authorize" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: source-$VERSION_ID" \
  -d '{
    "preferredDisposition": "attachment"
  }'
```

Current source authorization responses include:

- `authorizationMode`
- `resolvedOrigin`
- `url`
- `expiresAt`

### 10. Handle errors as RFC 9457 problem details

Public API failures use problem-detail responses such as:

```json
{
  "type": "https://docs.cdngine.dev/problems/version-not-ready",
  "title": "Version not ready",
  "status": 409,
  "detail": "Requested derivatives are not yet published for this immutable version.",
  "retryable": true
}
```

Treat `retryable: true` as the signal that a retry or later poll may succeed.

## Step by step: the checked-in TypeScript SDK

The current TypeScript client is the workspace package `@cdngine/sdk`.

### 1. Know what the SDK wraps today

The checked-in client currently wraps these public flows:

- `getAsset(...)`
- `createUploadSession(...)`
- `completeUploadSession(...)`
- `getAssetVersion(...)`
- `waitForVersion(...)`
- `listDerivatives(...)`
- `getManifest(...)`
- `authorizeDelivery(...)`
- `authorizeSourceDownload(...)`
- `uploadFile(...)`
- `uploadFileAndWait(...)`
- `withDefaults(...)`
- `scope(...)`
- grouped helpers such as `client.assets.*`
- fluent version helpers such as `client.asset(assetId).version(versionId)...`

Current repo-level limits:

- publish to npm as a public package

### 2. Create the client

```ts
import { createCDNgineClient } from '@cdngine/sdk';

const client = createCDNgineClient({
  baseUrl: 'https://api.cdngine.local',
  getAccessToken: () => process.env.CDNGINE_TOKEN
});
```

`getAccessToken` can be a string or an async function. Use the function form if your host app refreshes tokens.

### 3. Real file-upload flow with the SDK

This is the primary end-to-end flow for a file on disk today: bind the repeating scope once, then upload with one call.

```ts
import { readFile } from 'node:fs/promises';

import { CDNgineClientError, createCDNgineClient } from '@cdngine/sdk';

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
    timeoutMs: 30_000,
    intervalMs: 1_000,
    untilStates: ['published']
  }
});

try {
  const uploaded = await media.upload(fileBuffer, {
    contentType: 'image/png',
    filename: 'hero-banner.png',
    idempotencyKey: 'hero-banner-v1'
  });

  const asset = await client.assets.get(uploaded.assetId);
  const versionClient = client.asset(uploaded.assetId).version(uploaded.versionId);
  const derivatives = await versionClient.listDerivatives();
  const manifest = await versionClient.manifest('image-default').get();
  const delivery = await versionClient.delivery('public-images').authorize({
    idempotencyKey: `delivery-${uploaded.versionId}`,
    body: {
      variant: 'webp-master',
      responseFormat: 'url'
    }
  });
  const source = await versionClient.authorizeSourceDownload({
    idempotencyKey: `source-${uploaded.versionId}`,
    body: {
      preferredDisposition: 'attachment'
    }
  });

  console.log({
    asset,
    uploaded,
    derivatives,
    manifest,
    delivery,
    source
  });
} catch (error) {
  if (error instanceof CDNgineClientError) {
    console.error('CDNgine rejected the request:', error.problem);
  } else {
    throw error;
  }
}
```

### 4. Use the fluent helpers after you already know the asset and version

Once you have the identifiers, the fluent path is the cleanest current read surface:

```ts
const asset = await client.assets.get(assetId);
const version = client.asset(assetId).version(versionId);

const latestVersion = asset.latestVersion;
const current = await version.get();
const derivatives = await version.listDerivatives();
const manifest = await version.manifest('image-default').get();
const delivery = await version.delivery('public-images').authorize({
  idempotencyKey: `delivery-${versionId}`,
  body: {
    variant: 'webp-master',
    responseFormat: 'url'
  }
});
const source = await version.authorizeSourceDownload({
  idempotencyKey: `source-${versionId}`,
  body: {
    preferredDisposition: 'attachment'
  }
});
```

### 5. Selling private files to authenticated tenant users

For a multi-tenant paid-download flow, split the responsibility like this:

1. your host app authenticates the caller
2. your host app checks the caller's purchase, subscription, or entitlement
3. your host app maps the caller into a CDNgine actor with the correct tenant and namespace scope
4. the SDK asks CDNgine for a short-lived delivery or source authorization result
5. the browser navigates to the returned URL or uses the returned bundle credentials

The important rule is: **do not store or hand out raw storage URLs as the product download link**. Ask CDNgine to authorize the download at request time.

#### 5.1 Host-side auth mapping

CDNgine enforces namespace and tenant isolation. Your application still owns the business rule that says whether the user bought the file.

That normally looks like this:

```ts
import { createRequestActorAuthenticator, extractBearerToken } from '@cdngine/auth';

const authenticator = createRequestActorAuthenticator(async (headers) => {
  const token = extractBearerToken(headers);
  if (!token) {
    return null;
  }

  const session = await verifyYourSession(token);
  if (!session) {
    return null;
  }

  const entitlement = await lookupDownloadEntitlement({
    tenantId: session.tenantId,
    userId: session.userId
  });

  if (!entitlement.canDownloadPaidAssets) {
    return null;
  }

  return {
    subject: session.userId,
    roles: ['public-user'],
    allowedServiceNamespaces: ['media-platform'],
    allowedTenantIds: [session.tenantId]
  };
});
```

That is the right place to answer:

- did the user sign in?
- which tenant do they belong to?
- did they buy this product or have an active subscription?

CDNgine then answers:

- does this request stay inside the allowed tenant and namespace?
- is this delivery scope allowed?
- what short-lived URL or bundle credential should the caller receive?

#### 5.2 Browser or app code for a private derivative download

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
  idempotencyKey: `download-ver_001-user_123`,
  variant: 'webp-master'
});

window.location.assign(url);
```

That is the normal flow for selling a transformed or published file to signed-in tenant users.

#### 5.3 If you want the original source file instead

Use the source-authorization endpoint instead of a delivery-scope authorization:

```ts
const url = await client.asset(assetId).version(versionId).source().url({
  idempotencyKey: `source-${versionId}-user_123`,
  preferredDisposition: 'attachment'
});

window.location.assign(url);
```

#### 5.4 Failure semantics to expect

- if the caller is not authenticated, the control-plane request should fail with `401`
- if the caller is authenticated but outside the allowed tenant or namespace, the control-plane request should fail with `403`
- if the final public delivery path is private, the delivery endpoint itself should usually behave as non-disclosing `404`

That combination is what you want for a real paid-download surface: useful control-plane errors for your app, but non-disclosing public delivery behavior for unauthorized fetches.

### 6. Prefer `withDefaults(...).upload(...)` for the common case

For most apps, the lowest-friction path is:

```ts
const media = client.withDefaults({
  assetOwner: 'customer:acme',
  serviceNamespaceId: 'media-platform',
  tenantId: 'tenant-acme',
  wait: {
    untilStates: ['published']
  }
});

const uploaded = await media.upload(file, {
  filename: 'hero-banner.png',
  contentType: 'image/png'
});
```

Under that, `assets.uploadFile(...)` and `assets.uploadFileAndWait(...)` remain the explicit all-options form.

They own:

1. upload-session creation
2. checksum and byte-length derivation
3. staged upload to the returned tus target
4. upload completion
5. optional wait-for-publication polling

You should still use the lower-level `assets.upload(...)` and `assets.uploadAndWait(...)` only when your bytes are already staged or when another layer already handled the upload-target interaction.

### 7. Use typed error handling

The SDK throws `CDNgineClientError` when the API returns a problem-detail response.

```ts
import { CDNgineClientError } from '@cdngine/sdk';

try {
  await client.asset(assetId).version(versionId).manifest('image-default').get();
} catch (error) {
  if (error instanceof CDNgineClientError) {
    console.error(error.problem.type, error.problem.status, error.problem.retryable);
  } else {
    throw error;
  }
}
```

### 8. Wire tiny React buttons first

The first SDK example should be small enough to copy into an app in a few minutes.

Start with this shape:

1. create one client
2. bind your tenant or upload defaults once
3. call one SDK method inside the button handler

#### 8.1 Simple upload button

```tsx
"use client";

import { useState } from "react";
import { CDNgineClientError, createCDNgineClient } from "@cdngine/sdk";

const client = createCDNgineClient({
  baseUrl: import.meta.env.VITE_CDNGINE_API_BASE_URL,
  getAccessToken: () =>
    window.localStorage.getItem("cdngine_access_token") ?? undefined,
});

const media = client.withDefaults({
  assetOwner: "customer:acme",
  serviceNamespaceId: "media-platform",
  tenantId: "tenant-acme",
  wait: {
    untilStates: ["published"],
  },
});

export function UploadButton() {
  const [status, setStatus] = useState("Choose a file.");

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setStatus("Uploading...");

      const result = await media.upload(file, {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        idempotencyKey: `upload-${file.name}-${file.size}`,
      });

      setStatus(`Ready: ${result.assetId}/${result.versionId}`);
    } catch (error) {
      setStatus(
        error instanceof CDNgineClientError
          ? error.problem.detail ?? error.problem.title ?? "Upload rejected."
          : error instanceof Error
            ? error.message
            : "Upload failed."
      );
    }
  }

  return (
    <>
      <input type="file" onChange={onChange} />
      <p>{status}</p>
    </>
  );
}
```

#### 8.2 Smallest useful paid-download button

```tsx
"use client";

import { useState } from "react";
import { CDNgineClientError, createCDNgineClient } from "@cdngine/sdk";

const client = createCDNgineClient({
  baseUrl: import.meta.env.VITE_CDNGINE_API_BASE_URL,
  getAccessToken: () =>
    window.localStorage.getItem("cdngine_access_token") ?? undefined,
});

const downloads = client.withDefaults({
  serviceNamespaceId: "media-platform",
  tenantId: "tenant-acme",
});

export function DownloadButton(props: { assetId: string; versionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onClick() {
    try {
      setBusy(true);
      setError(undefined);

      const url = await downloads
        .asset(props.assetId)
        .version(props.versionId)
        .delivery("paid-downloads")
        .url({
          idempotencyKey: `download-${props.versionId}`,
          variant: "webp-master",
        });

      window.location.assign(url);
    } catch (error) {
      setError(
        error instanceof CDNgineClientError
          ? error.problem.detail ?? error.problem.title ?? "Download rejected."
          : error instanceof Error
            ? error.message
            : "Download failed."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={onClick}>
        {busy ? "Preparing download..." : "Download file"}
      </button>
      {error ? <p>{error}</p> : null}
    </>
  );
}
```

If you are selling the original file instead of a published derivative, swap the delivery call for:

```ts
const url = await downloads.asset(assetId).version(versionId).source().url({
  idempotencyKey: `source-${versionId}`,
  preferredDisposition: "attachment",
});
```

Build the bigger upload queue, retry list, and progress UI only after this smallest version is working.

## Current gaps to plan around

If you are integrating against the repository today, assume these gaps are still yours to handle:

1. mounting the public API into a real host application
2. issuing or validating caller access tokens in the host application
3. publishing or vendoring the TypeScript SDK outside this monorepo

## Read next

- [API Surface](./api-surface.md)
- [SDK Strategy](./sdk-strategy.md)
- [Security Model](./security-model.md)
- [Service Architecture](./service-architecture.md)
- `[@cdngine/sdk` README](../packages/sdk/README.md)

