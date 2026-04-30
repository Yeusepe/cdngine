/**
 * Purpose: Wraps the production public upload lifecycle for the public upload client so browser uploads use upload sessions, TUS targets, completion, and version reads instead of legacy shims.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/sdk-strategy.md
 * External references:
 * - https://tus.io/protocols/resumable-upload
 * - https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
 * Tests:
 * - apps/demo/test/prod-upload-flow.test.ts
 */

import {
  createCDNgineClient,
  type UploadFileAndWaitResult,
  type WaitForVersionOptions
} from '@cdngine/sdk'

const PRODUCT_CLIENT_WAIT_OPTIONS: WaitForVersionOptions = {
  intervalMs: 500,
  timeoutMs: 30_000,
  untilStates: ['canonicalizing', 'canonical', 'processing', 'published', 'quarantined']
}

export interface UploadFileThroughProdApiInput {
  assetId?: string
  assetOwner: string
  baseUrl: string
  contentType?: string
  fetchImpl?: typeof fetch
  file: Blob | ArrayBuffer | ArrayBufferView
  filename?: string
  idempotencyKey?: string
  onUploadProgress?: (progress: number) => void
  serviceNamespaceId: string
  tenantId?: string
  wait?: WaitForVersionOptions
}

export type ProdUploadFlowResult = UploadFileAndWaitResult

function getProductClientWaitOptions(
  waitOverrides?: WaitForVersionOptions
): WaitForVersionOptions {
  return {
    ...PRODUCT_CLIENT_WAIT_OPTIONS,
    ...(waitOverrides ?? {})
  }
}

export async function uploadFileThroughProdApi(
  input: UploadFileThroughProdApiInput
): Promise<ProdUploadFlowResult> {
  const client = createCDNgineClient({
    baseUrl: input.baseUrl,
    ...(input.fetchImpl ? { fetch: input.fetchImpl } : {})
  })

  return client.assets.uploadFileAndWait({
    ...(input.assetId ? { assetId: input.assetId } : {}),
    assetOwner: input.assetOwner,
    ...(input.contentType ? { contentType: input.contentType } : {}),
    file: input.file,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.onUploadProgress ? { onUploadProgress: input.onUploadProgress } : {}),
    serviceNamespaceId: input.serviceNamespaceId,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    wait: getProductClientWaitOptions(input.wait)
  })
}
