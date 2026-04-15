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

### What these values are and why they exist

| Name | What it is | Why CDNgine needs it |
| --- | --- | --- |
| `API_BASE_URL` | The base URL where your host application mounted the CDNgine public API. | The SDK and raw HTTP calls need one stable entrypoint for all public operations. |
| `ACCESS_TOKEN` | A bearer token issued by **your** auth system. | CDNgine does not authenticate users by itself; it consumes your host app's authenticated actor context. |
| `serviceNamespaceId` | The internal CDNgine namespace your application registered for a workload or product area. | It keeps one application's assets, policies, and recipes distinct from another's. |
| `tenantId` | The tenant or customer boundary inside a namespace. | Use it when one namespace serves many customers and you need strict tenant isolation. |
| `assetOwner` | The caller-facing subject that owns the asset, such as `customer:acme` or `user:123`. | CDNgine persists it as part of policy and ownership checks instead of forcing callers to infer ownership from IDs. |
| `objectKey` | The staging key used during upload before canonicalization finishes. | The raw HTTP flow needs it because the public API asks you to describe the staged object before canonical truth exists. |
| `byteLength` and `sha256` | The size and checksum of the bytes you are uploading. | They let CDNgine verify that the staged object matches the upload session request and completion call. |
| `idempotencyKey` | A caller-chosen retry key for a mutating request. | It makes retries safe so accidental duplicate submits converge on one logical operation instead of creating duplicates. |
| `deliveryScopeId` | A named published-delivery policy such as `public-images` or `paid-downloads`. | It tells CDNgine which delivery rules, cache behavior, and authorization posture apply to this read. |
| `variant` | The published derivative variant you want, such as `webp-master` or `ebook-pdf`. | One immutable version may publish many outputs; the variant chooses which published file family you want. |
| `preferredDisposition` | Whether the browser should treat the result as `attachment` or `inline`. | It lets your app express whether the source file should download immediately or try to open in-browser. |

### Which SDK helper should I reach for?

| Helper | Use it when | What it saves you from |
| --- | --- | --- |
| `createCDNgineClient(...)` | You need one root client for your app. | Repeating the API base URL, bearer token plumbing, and shared headers on every call. |
| `client.withDefaults(...)` | Most calls in this part of the app share the same tenant, namespace, or asset owner. | Repeating scope fields on every upload or download call. |
| `media.upload(file, ...)` | You want the normal one-call upload path. | Manually creating an upload session, talking to tus, completing the upload, and polling for readiness. |
| `media.uploadFile(file, ...)` | You want the upload orchestration, but you do **not** want to wait for publication. | The same upload plumbing, while returning as soon as the upload is accepted. |
| `client.asset(assetId).version(versionId)` | You already know the identifiers and want to read or authorize against that exact immutable version. | Reconstructing version URLs by hand. |
| `version.delivery(scope).url(...)` | You want a short-lived URL for a published derivative. | Building the authorization request body manually and extracting `response.url` yourself. |
| `version.source().url(...)` | You want a short-lived URL for the original uploaded source file. | Calling the lower-level source authorize operation and unpacking the response manually. |
| `version.delivery(scope).authorize(...)` | You need the full authorization response, not just the URL. | Hiding delivery modes when you actually need details such as cookies or origin resolution. |
| `version.source().authorize(...)` | You need the full source authorization response, not just a URL. | The same, but for original-source reads. |

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

This call exists to declare **what you are about to upload** before CDNgine accepts the staged object as real work.

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

A few fields matter more than the rest:

| Field | What it does |
| --- | --- |
| `serviceNamespaceId` | Tells CDNgine which namespace owns this upload. |
| `tenantId` | Applies tenant isolation when the namespace is multi-tenant. |
| `assetOwner` | Records the human-meaningful owner used for policy and audit. |
| `source.filename` | Preserves the original file name as part of source metadata. |
| `source.contentType` | Tells downstream processors what media type the caller claims to be uploading. |
| `upload.objectKey` | Identifies where the raw staged bytes will land before canonicalization. |
| `upload.byteLength` | Lets CDNgine verify the exact byte size at completion time. |
| `upload.checksum` | Lets CDNgine verify the staged object matches the request and prevents accidental corruption drift. |
| `Idempotency-Key` header | Makes retries safe if your client times out or the network drops after submit. |

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

This call tells CDNgine: "the staged upload finished, verify it and begin canonicalization plus workflow dispatch."

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

Use this when you want a **published** output such as an image variant, presentation artifact, or paid download derivative.

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

The fields you send mean:

| Field | What it means |
| --- | --- |
| `deliveryScopeId` in the URL | Which delivery policy you want to use, such as a public image scope or an authenticated paid-download scope. |
| `variant` | Which published derivative you want from this immutable version. |
| `responseFormat` | What kind of auth result you want back. In the tutorial examples, `url` means "give me one URL I can redirect the browser to." |
| `Idempotency-Key` header | Makes authorize retries safe in the same way as upload retries. |

### 9. Authorize original-source download

Use this when the product experience is "download the exact original file the user uploaded," not "download a published derivative."

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

The key request field here is:

| Field | What it means |
| --- | --- |
| `preferredDisposition` | `attachment` asks the browser to download the file; `inline` asks the browser to open it directly when possible. |

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

This is the root object for the whole SDK. Almost every app should create **one** client and reuse it.

```ts
import { createCDNgineClient } from '@cdngine/sdk';

// createCDNgineClient(...) builds the one root SDK client for your app.
const client = createCDNgineClient({
  // baseUrl points at the host app that mounted the CDNgine public API.
  baseUrl: 'https://api.cdngine.local',
  // getAccessToken supplies the bearer token CDNgine should send on requests.
  getAccessToken: () => process.env.CDNGINE_TOKEN
});
```

`getAccessToken` can be a string or an async function. Use the function form if your host app refreshes tokens.

| Option | What it is for |
| --- | --- |
| `baseUrl` | Points the client at the host app's mounted CDNgine API. |
| `getAccessToken` | Supplies the bearer token CDNgine should send on authenticated calls. Use a function when tokens refresh or live in request-scoped storage. |
| `fetch` | Optional override for tests, custom runtimes, or instrumentation. |
| `getHeaders` | Optional way to attach extra headers such as trace or correlation IDs. |

### 3. Real file-upload flow with the SDK

This is the primary end-to-end flow for a file on disk today: bind the repeating scope once, then upload with one call.

```ts
import { readFile } from 'node:fs/promises';

import { CDNgineClientError, createCDNgineClient } from '@cdngine/sdk';

const filePath = './hero-banner.png';
const fileBuffer = await readFile(filePath);

// createCDNgineClient(...) is the root SDK entrypoint.
const client = createCDNgineClient({
  // baseUrl is the mounted CDNgine API host.
  baseUrl: 'https://api.cdngine.local',
  // getAccessToken tells the SDK how to fetch the current bearer token.
  getAccessToken: () => process.env.CDNGINE_TOKEN
});

// withDefaults(...) creates a scoped client so repeated namespace, tenant,
// owner, and wait settings do not need to be repeated on every call.
const media = client.withDefaults({
  // assetOwner is the caller-facing owner CDNgine should persist for policy.
  assetOwner: 'customer:acme',
  // serviceNamespaceId selects the registered CDNgine namespace.
  serviceNamespaceId: 'media-platform',
  // tenantId applies tenant isolation inside that namespace.
  tenantId: 'tenant-acme',
  wait: {
    // timeoutMs caps how long upload(...) should poll before failing.
    timeoutMs: 30_000,
    // intervalMs controls how often the SDK polls version state.
    intervalMs: 1_000,
    // untilStates defines which lifecycle states count as "done waiting".
    untilStates: ['published']
  }
});

try {
  // media.upload(...) is the high-level "upload this file and wait until ready"
  // helper. It owns session creation, tus upload, completion, and polling.
  const uploaded = await media.upload(fileBuffer, {
    // contentType records the uploaded media type.
    contentType: 'image/png',
    // filename sets the persisted source file name.
    filename: 'hero-banner.png',
    // idempotencyKey makes retries converge on one logical upload intent.
    idempotencyKey: 'hero-banner-v1'
  });

  // client.assets.get(...) fetches the logical asset record.
  const asset = await client.assets.get(uploaded.assetId);
  // client.asset(...).version(...) creates a fluent handle to one immutable version.
  const versionClient = client.asset(uploaded.assetId).version(uploaded.versionId);
  // listDerivatives() returns the published derivative set for that version.
  const derivatives = await versionClient.listDerivatives();
  // manifest(...).get() fetches one manifest document by manifest type.
  const manifest = await versionClient.manifest('image-default').get();
  // delivery(...).authorize(...) returns the full delivery authorization payload.
  const delivery = await versionClient.delivery('public-images').authorize({
    // idempotencyKey makes repeated authorization attempts safe.
    idempotencyKey: `delivery-${uploaded.versionId}`,
    body: {
      // variant chooses which published output you want.
      variant: 'webp-master',
      // responseFormat asks for a redirectable URL instead of another auth shape.
      responseFormat: 'url'
    }
  });
  // authorizeSourceDownload(...) returns the full authorization payload for the
  // original uploaded source file.
  const source = await versionClient.authorizeSourceDownload({
    idempotencyKey: `source-${uploaded.versionId}`,
    body: {
      // preferredDisposition asks the browser to download instead of inline-open.
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
  // CDNgineClientError is the typed SDK error for RFC 9457 problem responses.
  if (error instanceof CDNgineClientError) {
    console.error('CDNgine rejected the request:', error.problem);
  } else {
    throw error;
  }
}
```

Why this shape exists:

1. `client.withDefaults(...)` lets you bind repeated scope once for this part of the app.
2. `media.upload(...)` is the "normal app code" path. It owns the multi-step upload protocol for you.
3. `client.asset(...).version(...)` gives you a stable handle to one immutable version after upload finishes.

The most important options in this example are:

| Option | Where | What it does |
| --- | --- | --- |
| `assetOwner` | `withDefaults(...)` | Sets the owner string CDNgine should persist for policy and audit. |
| `serviceNamespaceId` | `withDefaults(...)` | Tells CDNgine which namespace this upload belongs to. |
| `tenantId` | `withDefaults(...)` | Applies multi-tenant isolation for this default client scope. |
| `wait.untilStates` | `withDefaults(...)` | Tells `upload(...)` which lifecycle states should count as "done waiting." |
| `wait.timeoutMs` | `withDefaults(...)` | Caps how long the helper should poll before giving up. |
| `wait.intervalMs` | `withDefaults(...)` | Controls how often the helper polls version state. |
| `filename` | `media.upload(...)` | Sets the source file name when the input bytes do not already carry one or when you want to override it. |
| `contentType` | `media.upload(...)` | Sets the uploaded media type. |
| `idempotencyKey` | `media.upload(...)` | Makes retries converge on one logical upload. |

### 4. Use the fluent helpers after you already know the asset and version

Once you have the identifiers, the fluent path is the cleanest current read surface:

```ts
// client.assets.get(...) reads the logical asset record by ID.
const asset = await client.assets.get(assetId);
// client.asset(...).version(...) creates a fluent handle to one immutable version.
const version = client.asset(assetId).version(versionId);

const latestVersion = asset.latestVersion;
// get() fetches the current version document.
const current = await version.get();
// listDerivatives() fetches all published derivatives for this version.
const derivatives = await version.listDerivatives();
// manifest(...).get() fetches one manifest by its manifest type.
const manifest = await version.manifest('image-default').get();
// delivery(...).authorize(...) returns the full delivery authorization response.
const delivery = await version.delivery('public-images').authorize({
  idempotencyKey: `delivery-${versionId}`,
  body: {
    // variant chooses the published derivative you want.
    variant: 'webp-master',
    // responseFormat='url' asks CDNgine for a URL-shaped response.
    responseFormat: 'url'
  }
});
// authorizeSourceDownload(...) returns the full source-download authorization response.
const source = await version.authorizeSourceDownload({
  idempotencyKey: `source-${versionId}`,
  body: {
    // preferredDisposition='attachment' tells browsers to download the file.
    preferredDisposition: 'attachment'
  }
});
```

Read this chain left to right:

1. `client.asset(assetId)` means "this logical asset"
2. `.version(versionId)` means "this exact immutable revision"
3. `.manifest(...)`, `.delivery(...)`, and `.source()` mean "what do you want to do with that revision?"

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

Use this when your product flow is "the signed-in user is allowed to download one published output from this version."

```ts
// createCDNgineClient(...) builds the root SDK client for browser code too.
const client = createCDNgineClient({
  // baseUrl points at your mounted public API.
  baseUrl: 'https://api.cdngine.local',
  // getAccessToken reads the signed-in user's bearer token from app storage.
  getAccessToken: () => sessionStorage.getItem('access_token') ?? undefined
});

// withDefaults(...) binds the tenant scope once for all download buttons in this UI.
const downloads = client.withDefaults({
  // serviceNamespaceId selects the namespace that owns this product surface.
  serviceNamespaceId: 'media-platform',
  // tenantId scopes all later calls to the active customer tenant.
  tenantId: 'tenant-acme'
});

// asset(...).version(...) points at the exact immutable version the user bought.
// delivery('paid-downloads') chooses the delivery policy for this paid surface.
// url(...) is the shorthand helper that returns only the final redirect URL.
const url = await downloads.asset('ast_001').version('ver_001').delivery('paid-downloads').url({
  // idempotencyKey keeps repeated clicks or retries safe.
  idempotencyKey: `download-ver_001-user_123`,
  // variant chooses which published output to hand to the user.
  variant: 'webp-master'
});

// Redirect the browser to the short-lived authorized URL.
window.location.assign(url);
```

That is the normal flow for selling a transformed or published file to signed-in tenant users.

What each part is doing:

| Piece | Why it is there |
| --- | --- |
| `client.withDefaults({ serviceNamespaceId, tenantId })` | Binds the caller's tenant scope once instead of repeating it for every button click. |
| `.asset(...).version(...)` | Targets one exact immutable version that the user bought or is allowed to access. |
| `.delivery('paid-downloads')` | Selects the delivery policy for the paid-download product surface. |
| `.url(...)` | Says "I want the simplest possible result: a URL I can redirect the browser to." |
| `idempotencyKey` | Keeps repeated button clicks or retries from creating ambiguous duplicate authorization requests. |
| `variant` | Chooses which published output the user is actually downloading. |

#### 5.3 If you want the original source file instead

Use the source-authorization endpoint instead of a delivery-scope authorization:

```ts
// asset(...).version(...) targets the exact immutable version.
// source().url(...) is the shorthand helper for an original-source download URL.
const url = await client.asset(assetId).version(versionId).source().url({
  // idempotencyKey keeps retries or repeated clicks safe.
  idempotencyKey: `source-${versionId}-user_123`,
  // preferredDisposition tells the browser to download rather than inline-open.
  preferredDisposition: 'attachment'
});

// Redirect the browser to the short-lived source-download URL.
window.location.assign(url);
```

Use source download when you mean "give the user the original uploaded file." Use delivery download when you mean "give the user one of the published outputs."

#### 5.4 Failure semantics to expect

- if the caller is not authenticated, the control-plane request should fail with `401`
- if the caller is authenticated but outside the allowed tenant or namespace, the control-plane request should fail with `403`
- if the final public delivery path is private, the delivery endpoint itself should usually behave as non-disclosing `404`

That combination is what you want for a real paid-download surface: useful control-plane errors for your app, but non-disclosing public delivery behavior for unauthorized fetches.

### 6. Prefer `withDefaults(...).upload(...)` for the common case

For most apps, the lowest-friction path is:

```ts
// withDefaults(...) binds the common upload scope once.
const media = client.withDefaults({
  assetOwner: 'customer:acme',
  serviceNamespaceId: 'media-platform',
  tenantId: 'tenant-acme',
  wait: {
    untilStates: ['published']
  }
});

// upload(...) is the shortest high-level helper for "upload this file and wait".
const uploaded = await media.upload(file, {
  // filename sets the persisted source file name.
  filename: 'hero-banner.png',
  // contentType records the media type for downstream processing.
  contentType: 'image/png'
});
```

Choose between the upload helpers like this:

| Helper | When to use it |
| --- | --- |
| `media.upload(...)` | You want the simplest "upload and wait until useful" path. |
| `media.uploadFile(...)` | You want upload orchestration but will poll or continue later yourself. |
| `client.assets.uploadFileAndWait(...)` | You want the full explicit parameter object without using defaults. |
| `client.assets.uploadFile(...)` | You want the explicit non-waiting form without using defaults. |

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
  // asset(...).version(...).manifest(...).get() reads one manifest document.
  await client.asset(assetId).version(versionId).manifest('image-default').get();
} catch (error) {
  // CDNgineClientError exposes the parsed RFC 9457 problem payload.
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

Why this example exists: it is the smallest complete React example that proves you do **not** need a giant upload manager to get started.

```tsx
"use client";

import { useState } from "react";
import { CDNgineClientError, createCDNgineClient } from "@cdngine/sdk";

// createCDNgineClient(...) builds the one root SDK client for this page.
const client = createCDNgineClient({
  // baseUrl points the SDK at your mounted public API.
  baseUrl: import.meta.env.VITE_CDNGINE_API_BASE_URL,
  // getAccessToken reads the current user's bearer token from local app storage.
  getAccessToken: () =>
    window.localStorage.getItem("cdngine_access_token") ?? undefined,
});

// withDefaults(...) creates a scoped upload client for this tenant and namespace.
const media = client.withDefaults({
  // assetOwner is the owner label CDNgine persists for policy and audit.
  assetOwner: "customer:acme",
  // serviceNamespaceId picks the registered namespace for this app flow.
  serviceNamespaceId: "media-platform",
  // tenantId scopes later upload calls to the active tenant.
  tenantId: "tenant-acme",
  wait: {
    // untilStates tells upload(...) which lifecycle state counts as "ready".
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

      // media.upload(...) owns session creation, tus upload, completion, and polling.
      const result = await media.upload(file, {
        // filename preserves the file name the user selected.
        filename: file.name,
        // contentType records the browser-reported file type.
        contentType: file.type || "application/octet-stream",
        // idempotencyKey makes retries safe for the same upload intent.
        idempotencyKey: `upload-${file.name}-${file.size}`,
      });

      setStatus(`Ready: ${result.assetId}/${result.versionId}`);
    } catch (error) {
      setStatus(
        // CDNgineClientError is the typed SDK error for problem-detail responses.
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

What to customize first:

| Field | What you usually change |
| --- | --- |
| `baseUrl` | Point it at your mounted API host. |
| `getAccessToken` | Read from your own session, auth store, or token refresh helper. |
| `assetOwner` | Set it to the product-facing owner you use for policy. |
| `serviceNamespaceId` | Set it to the namespace registered for this app or workload. |
| `tenantId` | Set it when the current user is acting inside a tenant. |
| `wait.untilStates` | Usually keep `published` when your UI needs derivatives before showing success. |
| `idempotencyKey` | Make it stable enough for retries but specific enough that different uploads are not collapsed together. |

#### 8.1.1 About the `onChange` parameter

The `event` parameter is the normal React file-input change event:

- `event.target.files?.[0]` is the selected browser `File`
- `file.name` becomes the upload filename unless you override it
- `file.type` becomes the content type when present
- the `File` object itself is what you pass into `media.upload(...)`

#### 8.2 Smallest useful paid-download button

Why this example exists: it shows the smallest real "sell a file to a signed-in tenant user" button without exposing storage URLs or forcing the UI to know delivery internals.

```tsx
"use client";

import { useState } from "react";
import { CDNgineClientError, createCDNgineClient } from "@cdngine/sdk";

// createCDNgineClient(...) builds the shared root SDK client.
const client = createCDNgineClient({
  // baseUrl points at your mounted public API.
  baseUrl: import.meta.env.VITE_CDNGINE_API_BASE_URL,
  // getAccessToken reads the current signed-in user's bearer token.
  getAccessToken: () =>
    window.localStorage.getItem("cdngine_access_token") ?? undefined,
});

// withDefaults(...) binds the namespace and tenant once for later download calls.
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

      // asset(...).version(...) targets the exact immutable version.
      // delivery("paid-downloads") selects the delivery policy for this product.
      // url(...) is the shorthand helper that returns only the final redirect URL.
      const url = await downloads
        .asset(props.assetId)
        .version(props.versionId)
        .delivery("paid-downloads")
        .url({
          // idempotencyKey makes repeated clicks safe.
          idempotencyKey: `download-${props.versionId}`,
          // variant chooses which published output the user should receive.
          variant: "webp-master",
        });

      // Redirect the browser to the authorized short-lived URL.
      window.location.assign(url);
    } catch (error) {
      setError(
        // CDNgineClientError is the typed SDK error for problem-detail responses.
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

What to customize first:

| Field | What you usually change |
| --- | --- |
| `serviceNamespaceId` | The namespace this product surface belongs to. |
| `tenantId` | The current tenant or customer context. |
| `assetId` and `versionId` | The exact immutable version your product page or entitlement system is pointing at. |
| `delivery("paid-downloads")` | The delivery scope you registered for authenticated sales. |
| `variant` | The published output to hand to the user. |
| `idempotencyKey` | A stable retry key for repeated clicks on the same download intent. |

If you are selling the original file instead of a published derivative, swap the delivery call for:

```ts
// asset(...).version(...) targets the exact immutable version.
// source().url(...) is the shorthand helper for the original uploaded file.
const url = await downloads.asset(assetId).version(versionId).source().url({
  // idempotencyKey keeps retries safe.
  idempotencyKey: `source-${versionId}`,
  // preferredDisposition tells the browser to download the file.
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
- [`@cdngine/sdk` README](../packages/sdk/README.md)
