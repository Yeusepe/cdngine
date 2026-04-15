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
- [Better Auth docs](https://www.better-auth.com/docs)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)

## What is actually implemented right now

The current repository gives you these pieces:

| Piece | Current reality |
| --- | --- |
| Public HTTP contract | Implemented and described in `contracts/openapi/public.openapi.yaml` |
| Public Hono app | Implemented in `@cdngine/api` and exercised in tests, but **not** shipped as a standalone `npm run api:start` server yet |
| Auth posture | Public routes require a **Better Auth bearer token**; the repo does **not** yet ship a public sign-in tutorial flow or token-issuing API surface |
| TypeScript SDK | Implemented in the private workspace package `@cdngine/sdk`; it is a checked-in repo package, **not** a published npm package yet |
| SDK upload behavior | The SDK now owns create-session, staged upload, completion, and optional wait through `client.assets.uploadFile(...)` and `client.assets.uploadFileAndWait(...)` |
| Asset lookup coverage | The SDK now wraps both `GET /v1/assets/{assetId}` and `GET /v1/assets/{assetId}/versions/{versionId}` |

That means the realistic integration posture today is:

1. your host app mounts the public API
2. your host app issues Better Auth bearer tokens
3. your app code uses the SDK as the primary integration surface
4. the SDK handles upload session creation, staged upload, completion, and polling for you
5. raw HTTP stays available as a reference and fallback surface, not the default developer path

## Before you start

You need these values regardless of whether you call the API directly or use the TypeScript client:

- `API_BASE_URL`: the host where your application mounted the CDNgine public API
- `ACCESS_TOKEN`: a Better Auth bearer token accepted by that host
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
ACCESS_TOKEN="replace-with-better-auth-bearer-token"

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

This is the primary end-to-end flow for a file on disk today.

```ts
import { readFile } from 'node:fs/promises';

import { CDNgineClientError, createCDNgineClient } from '@cdngine/sdk';

const filePath = './hero-banner.png';
const fileBuffer = await readFile(filePath);

const client = createCDNgineClient({
  baseUrl: 'https://api.cdngine.local',
  getAccessToken: () => process.env.CDNGINE_TOKEN
});

try {
  const uploaded = await client.assets.uploadFileAndWait({
    assetOwner: 'customer:acme',
    contentType: 'image/png',
    file: fileBuffer,
    filename: 'hero-banner.png',
    idempotencyKey: 'hero-banner-v1',
    serviceNamespaceId: 'media-platform',
    tenantId: 'tenant-acme',
    wait: {
      timeoutMs: 30_000,
      intervalMs: 1_000,
      untilStates: ['published']
    }
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

### 5. Prefer `assets.uploadFile(...)` and `assets.uploadFileAndWait(...)`

These are now the primary upload entry points for normal SDK users.

They own:

1. upload-session creation
2. checksum and byte-length derivation
3. staged upload to the returned tus target
4. upload completion
5. optional wait-for-publication polling

You should still use the lower-level `assets.upload(...)` and `assets.uploadAndWait(...)` only when your bytes are already staged or when another layer already handled the upload-target interaction.

### 6. Use typed error handling

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

### 7. Wire a React upload button to the SDK

If your app already has an upload UI component, wire it straight to `client.assets.uploadFileAndWait(...)`.

The SDK now owns the multi-step upload flow, so your component only needs to:

1. keep the `File` in state so retry works
2. pass the file to the SDK
3. update UI state from `onUploadProgress`
4. record the returned `assetId`, `versionId`, and lifecycle result

```tsx
"use client";

import { useState } from "react";
import {
  CDNgineClientError,
  createCDNgineClient,
} from "@cdngine/sdk";
import { FileUpload } from "@/components/application/file-upload/file-upload-base";

type UploadedFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  progress: number;
  failed?: boolean;
  assetId?: string;
  versionId?: string;
  lifecycleState?: string;
  sourceFile?: File;
  error?: string;
};

const placeholderFiles: UploadedFile[] = [
  {
    id: "file-01",
    name: "Example dashboard screenshot.jpg",
    type: "image/jpeg",
    size: 720 * 1024,
    progress: 50,
  },
  {
    id: "file-02",
    name: "Tech design requirements_2.pdf",
    type: "application/pdf",
    size: 720 * 1024,
    progress: 100,
  },
  {
    id: "file-03",
    name: "Tech design requirements.pdf",
    type: "application/pdf",
    failed: true,
    size: 1024 * 1024,
    progress: 0,
  },
];

const client = createCDNgineClient({
  baseUrl: import.meta.env.VITE_CDNGINE_API_BASE_URL,
  getAccessToken: () =>
    window.localStorage.getItem("cdngine_access_token") ?? undefined,
});

const SERVICE_NAMESPACE_ID = "media-platform";
const TENANT_ID = "tenant-acme";
const ASSET_OWNER = "customer:acme";

export const FileUploadProgressBar = (props: { isDisabled?: boolean }) => {
  const [uploadedFiles, setUploadedFiles] =
    useState<UploadedFile[]>(placeholderFiles);

  const handleDropFiles = (files: FileList) => {
    const newFilesWithIds: UploadedFile[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      progress: 0,
      sourceFile: file,
    }));

    setUploadedFiles((prev) => [...newFilesWithIds, ...prev]);

    newFilesWithIds.forEach((file) => {
      if (!file.sourceFile) {
        return;
      }

      void client.assets
        .uploadFileAndWait({
          assetOwner: ASSET_OWNER,
          contentType: file.sourceFile.type || "application/octet-stream",
          file: file.sourceFile,
          filename: file.sourceFile.name,
          idempotencyKey: `upload-${file.id}`,
          onUploadProgress: (progress) => {
            setUploadedFiles((prev) =>
              prev.map((uploadedFile) =>
                uploadedFile.id === file.id
                  ? { ...uploadedFile, progress, failed: false, error: undefined }
                  : uploadedFile
              )
            );
          },
          serviceNamespaceId: SERVICE_NAMESPACE_ID,
          tenantId: TENANT_ID,
          wait: {
            intervalMs: 1000,
            timeoutMs: 60000,
            untilStates: ["published"],
          },
        })
        .then((result) => {
          setUploadedFiles((prev) =>
            prev.map((uploadedFile) =>
              uploadedFile.id === file.id
                ? {
                    ...uploadedFile,
                    progress: 100,
                    failed: false,
                    assetId: result.assetId,
                    versionId: result.versionId,
                    lifecycleState: result.version.lifecycleState,
                  }
                : uploadedFile
            )
          );
        })
        .catch((error: unknown) => {
          const message =
            error instanceof CDNgineClientError
              ? error.problem.detail ??
                error.problem.title ??
                "CDNgine rejected the upload."
              : error instanceof Error
                ? error.message
                : "Upload failed.";

          setUploadedFiles((prev) =>
            prev.map((uploadedFile) =>
              uploadedFile.id === file.id
                ? {
                    ...uploadedFile,
                    failed: true,
                    progress: 0,
                    error: message,
                  }
                : uploadedFile
            )
          );
        });
    });
  };

  const handleDeleteFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== id));
  };

  const handleRetryFile = (id: string) => {
    const file = uploadedFiles.find((uploadedFile) => uploadedFile.id === id);
    if (!file?.sourceFile) return;

    setUploadedFiles((prev) =>
      prev.map((uploadedFile) =>
        uploadedFile.id === id
          ? {
              ...uploadedFile,
              failed: false,
              error: undefined,
              progress: 0,
            }
          : uploadedFile
      )
    );

    void client.assets
      .uploadFileAndWait({
        assetOwner: ASSET_OWNER,
        contentType: file.sourceFile.type || "application/octet-stream",
        file: file.sourceFile,
        filename: file.sourceFile.name,
        idempotencyKey: `upload-${file.id}`,
        onUploadProgress: (progress) => {
          setUploadedFiles((prev) =>
            prev.map((uploadedFile) =>
              uploadedFile.id === id
                ? { ...uploadedFile, progress, failed: false, error: undefined }
                : uploadedFile
            )
          );
        },
        serviceNamespaceId: SERVICE_NAMESPACE_ID,
        tenantId: TENANT_ID,
        wait: {
          intervalMs: 1000,
          timeoutMs: 60000,
          untilStates: ["published"],
        },
      })
      .then((result) => {
        setUploadedFiles((prev) =>
          prev.map((uploadedFile) =>
            uploadedFile.id === id
              ? {
                  ...uploadedFile,
                  progress: 100,
                  failed: false,
                  assetId: result.assetId,
                  versionId: result.versionId,
                  lifecycleState: result.version.lifecycleState,
                }
              : uploadedFile
          )
        );
      })
      .catch((error: unknown) => {
        const message =
          error instanceof CDNgineClientError
            ? error.problem.detail ??
              error.problem.title ??
              "CDNgine rejected the upload."
            : error instanceof Error
              ? error.message
              : "Upload failed.";

        setUploadedFiles((prev) =>
          prev.map((uploadedFile) =>
            uploadedFile.id === id
              ? {
                  ...uploadedFile,
                  failed: true,
                  progress: 0,
                  error: message,
                }
              : uploadedFile
          )
        );
      });
  };

  return (
    <FileUpload.Root>
      <FileUpload.DropZone
        isDisabled={props.isDisabled}
        onDropFiles={handleDropFiles}
      />

      <FileUpload.List>
        {uploadedFiles.map((file) => {
          const { sourceFile: _, error: __, ...uiFile } = file;

          return (
            <FileUpload.ListItemProgressBar
              key={file.id}
              {...uiFile}
              size={file.size}
              onDelete={() => handleDeleteFile(file.id)}
              onRetry={() => handleRetryFile(file.id)}
            />
          );
        })}
      </FileUpload.List>
    </FileUpload.Root>
  );
};
```

## Current gaps to plan around

If you are integrating against the repository today, assume these gaps are still yours to handle:

1. mounting the public API into a real host application
2. issuing Better Auth bearer tokens to callers
3. publishing or vendoring the TypeScript SDK outside this monorepo

## Read next

- [API Surface](./api-surface.md)
- [SDK Strategy](./sdk-strategy.md)
- [Security Model](./security-model.md)
- [Service Architecture](./service-architecture.md)
- [`@cdngine/sdk` README](../packages/sdk/README.md)
