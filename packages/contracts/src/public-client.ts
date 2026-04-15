/**
 * Purpose: Exposes a checked-in TypeScript client wrapper over the implemented public CDNgine contract so common flows do not need handwritten fetch calls.
 * Governing docs:
 * - docs/sdk-strategy.md
 * - docs/api-surface.md
 * - docs/spec-governance.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * Tests:
 * - packages/contracts/test/public-client.test.mjs
 */

import type { paths } from './generated/public-api.js';

export interface CDNgineProblem {
  detail?: string;
  instance?: string;
  retryable?: boolean;
  status?: number;
  title?: string;
  type: string;
}

export class CDNgineClientError extends Error {
  constructor(
    readonly problem: CDNgineProblem,
    readonly response: Response
  ) {
    super(problem.detail ?? problem.title ?? `CDNgine request failed with status ${response.status}.`);
    this.name = 'CDNgineClientError';
  }
}

export interface CDNgineClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  getAccessToken?: string | (() => string | Promise<string> | undefined);
}

export interface WaitForVersionOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  untilStates?: ReadonlyArray<GetAssetVersionResponse['lifecycleState']>;
}

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type CreateUploadSessionRequest =
  paths['/v1/upload-sessions']['post']['requestBody']['content']['application/json'];
type CreateUploadSessionResponse =
  paths['/v1/upload-sessions']['post']['responses']['201']['content']['application/json'];
type CompleteUploadSessionRequest =
  paths['/v1/upload-sessions/{uploadSessionId}/complete']['post']['requestBody']['content']['application/json'];
type CompleteUploadSessionResponse =
  paths['/v1/upload-sessions/{uploadSessionId}/complete']['post']['responses']['202']['content']['application/json'];
type GetAssetVersionResponse =
  paths['/v1/assets/{assetId}/versions/{versionId}']['get']['responses']['200']['content']['application/json'];
type ListDerivativesResponse =
  paths['/v1/assets/{assetId}/versions/{versionId}/derivatives']['get']['responses']['200']['content']['application/json'];
type GetManifestResponse =
  paths['/v1/assets/{assetId}/versions/{versionId}/manifests/{manifestType}']['get']['responses']['200']['content']['application/json'];
type AuthorizeSourceRequest =
  paths['/v1/assets/{assetId}/versions/{versionId}/source/authorize']['post']['requestBody']['content']['application/json'];
type AuthorizeSourceResponse =
  paths['/v1/assets/{assetId}/versions/{versionId}/source/authorize']['post']['responses']['200']['content']['application/json'];
type AuthorizeDeliveryRequest =
  paths['/v1/assets/{assetId}/versions/{versionId}/deliveries/{deliveryScopeId}/authorize']['post']['requestBody']['content']['application/json'];
type AuthorizeDeliveryResponse =
  paths['/v1/assets/{assetId}/versions/{versionId}/deliveries/{deliveryScopeId}/authorize']['post']['responses']['200']['content']['application/json'];

export interface CreateUploadSessionInput {
  body: CreateUploadSessionRequest;
  idempotencyKey: string;
}

export interface CompleteUploadSessionInput {
  body: CompleteUploadSessionRequest;
  idempotencyKey: string;
  uploadSessionId: string;
}

export interface AuthorizeSourceDownloadInput {
  assetId: string;
  body: AuthorizeSourceRequest;
  idempotencyKey: string;
  versionId: string;
}

export interface AuthorizeDeliveryInput {
  assetId: string;
  body: AuthorizeDeliveryRequest;
  deliveryScopeId: string;
  idempotencyKey: string;
  versionId: string;
}

function buildUrl(baseUrl: string, pathname: string) {
  return new URL(pathname.replace(/^\//, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      resolve(undefined);
    }, ms);

    function abortHandler() {
      clearTimeout(timeoutId);
      reject(new Error('Polling aborted.'));
    }

    signal?.addEventListener('abort', abortHandler, { once: true });
  });
}

export class CDNginePublicClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly getAccessToken: (() => string | Promise<string> | undefined) | undefined;

  constructor(private readonly options: CDNgineClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error('A fetch implementation is required to use CDNginePublicClient.');
    }

    if (typeof options.getAccessToken === 'function') {
      this.getAccessToken = options.getAccessToken;
    } else if (options.getAccessToken) {
      const accessToken = options.getAccessToken;
      this.getAccessToken = () => accessToken;
    }
  }

  async authorizeDelivery(input: AuthorizeDeliveryInput): Promise<AuthorizeDeliveryResponse> {
    return this.requestJson<AuthorizeDeliveryResponse>({
      body: input.body,
      headers: {
        'Idempotency-Key': input.idempotencyKey
      },
      method: 'POST',
      pathname: `/v1/assets/${input.assetId}/versions/${input.versionId}/deliveries/${input.deliveryScopeId}/authorize`
    });
  }

  async authorizeSourceDownload(
    input: AuthorizeSourceDownloadInput
  ): Promise<AuthorizeSourceResponse> {
    return this.requestJson<AuthorizeSourceResponse>({
      body: input.body,
      headers: {
        'Idempotency-Key': input.idempotencyKey
      },
      method: 'POST',
      pathname: `/v1/assets/${input.assetId}/versions/${input.versionId}/source/authorize`
    });
  }

  async completeUploadSession(
    input: CompleteUploadSessionInput
  ): Promise<CompleteUploadSessionResponse> {
    return this.requestJson<CompleteUploadSessionResponse>({
      body: input.body,
      headers: {
        'Idempotency-Key': input.idempotencyKey
      },
      method: 'POST',
      pathname: `/v1/upload-sessions/${input.uploadSessionId}/complete`
    });
  }

  async createUploadSession(input: CreateUploadSessionInput): Promise<CreateUploadSessionResponse> {
    return this.requestJson<CreateUploadSessionResponse>({
      body: input.body,
      headers: {
        'Idempotency-Key': input.idempotencyKey
      },
      method: 'POST',
      pathname: '/v1/upload-sessions'
    });
  }

  async getAssetVersion(assetId: string, versionId: string): Promise<GetAssetVersionResponse> {
    return this.requestJson<GetAssetVersionResponse>({
      method: 'GET',
      pathname: `/v1/assets/${assetId}/versions/${versionId}`
    });
  }

  async getManifest(
    assetId: string,
    versionId: string,
    manifestType: string
  ): Promise<GetManifestResponse> {
    return this.requestJson<GetManifestResponse>({
      method: 'GET',
      pathname: `/v1/assets/${assetId}/versions/${versionId}/manifests/${manifestType}`
    });
  }

  async listDerivatives(assetId: string, versionId: string): Promise<ListDerivativesResponse> {
    return this.requestJson<ListDerivativesResponse>({
      method: 'GET',
      pathname: `/v1/assets/${assetId}/versions/${versionId}/derivatives`
    });
  }

  async waitForVersion(
    assetId: string,
    versionId: string,
    options: WaitForVersionOptions = {}
  ): Promise<GetAssetVersionResponse> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const intervalMs = options.intervalMs ?? 1_000;
    const untilStates: readonly GetAssetVersionResponse['lifecycleState'][] = options.untilStates ?? [
      'canonical',
      'published',
      'quarantined'
    ];
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const version = await this.getAssetVersion(assetId, versionId);

      if (untilStates.includes(version.lifecycleState)) {
        return version;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for asset version "${versionId}" to reach one of ${untilStates.join(', ')}.`
        );
      }

      await sleep(intervalMs, options.signal);
    }
  }

  private async requestJson<TResponse>(input: {
    body?: JsonValue;
    headers?: Record<string, string>;
    method: 'GET' | 'POST';
    pathname: string;
  }): Promise<TResponse> {
    const headers = new Headers(input.headers);

    if (input.body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    const accessToken = await this.getAccessToken?.();

    if (accessToken) {
      headers.set('authorization', `Bearer ${accessToken}`);
    }

    const response = await this.fetchImpl(buildUrl(this.options.baseUrl, input.pathname), {
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      headers,
      method: input.method
    });
    const text = await response.text();
    const payload = text.length > 0 ? (JSON.parse(text) as TResponse | CDNgineProblem) : null;

    if (!response.ok) {
      throw new CDNgineClientError((payload ?? {
        type: 'about:blank'
      }) as CDNgineProblem, response);
    }

    return payload as TResponse;
  }
}

export type {
  AuthorizeDeliveryRequest,
  AuthorizeDeliveryResponse,
  AuthorizeSourceRequest,
  AuthorizeSourceResponse,
  CompleteUploadSessionRequest,
  CompleteUploadSessionResponse,
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  GetAssetVersionResponse,
  GetManifestResponse,
  ListDerivativesResponse
};
