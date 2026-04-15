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
 * - packages/sdk/test/public-client.test.mjs
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
  getHeaders?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string> | undefined> | undefined);
  getAccessToken?: string | (() => string | Promise<string> | undefined);
}

export interface CDNgineClientDefaults {
  assetOwner?: string;
  serviceNamespaceId?: string;
  tenantId?: string;
  wait?: WaitForVersionOptions;
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
type GetAssetResponse =
  paths['/v1/assets/{assetId}']['get']['responses']['200']['content']['application/json'];
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

export interface AuthorizeDeliveryForVersionInput {
  body: AuthorizeDeliveryRequest;
  idempotencyKey: string;
}

export interface AuthorizeSourceDownloadForVersionInput {
  body: AuthorizeSourceRequest;
  idempotencyKey: string;
}

export interface DeliveryUrlForVersionInput {
  idempotencyKey: string;
  variant: NonNullable<AuthorizeDeliveryRequest['variant']>;
}

export interface SourceUrlForVersionInput {
  idempotencyKey: string;
  preferredDisposition?: AuthorizeSourceRequest['preferredDisposition'];
}

export interface UploadAssetInput {
  complete: Omit<CompleteUploadSessionInput, 'uploadSessionId'>;
  create: CreateUploadSessionInput;
}

export interface UploadAssetResult {
  assetId: string;
  completion: CompleteUploadSessionResponse;
  session: CreateUploadSessionResponse;
  uploadSessionId: string;
  versionId: string;
}

export interface UploadFileInput {
  assetId?: string;
  assetOwner: string;
  contentType?: string;
  file: Blob | ArrayBuffer | ArrayBufferView;
  filename?: string;
  idempotencyKey?: string;
  objectKey?: string;
  onUploadProgress?: (progress: number) => void;
  serviceNamespaceId: string;
  tenantId?: string;
}

export interface UploadFileResult extends UploadAssetResult {
  checksum: {
    algorithm: 'sha256';
    value: string;
  };
  objectKey: string;
}

export interface UploadAssetAndWaitInput extends UploadAssetInput {
  wait?: WaitForVersionOptions;
}

export interface UploadAssetAndWaitResult extends UploadAssetResult {
  version: GetAssetVersionResponse;
}

export interface UploadFileAndWaitInput extends UploadFileInput {
  wait?: WaitForVersionOptions;
}

export interface UploadFileAndWaitResult extends UploadFileResult {
  version: GetAssetVersionResponse;
}

export interface ScopedUploadFileOptions
  extends Omit<UploadFileInput, 'assetOwner' | 'file' | 'serviceNamespaceId' | 'tenantId'> {
  assetOwner?: string;
  serviceNamespaceId?: string;
  tenantId?: string;
}

export interface ScopedUploadOptions extends Omit<ScopedUploadFileOptions, 'wait'> {
  wait?: WaitForVersionOptions;
}

type UploadBinaryPayload = Blob | ArrayBuffer | Uint8Array;

function buildUrl(baseUrl: string, pathname: string) {
  return new URL(pathname.replace(/^\//, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function bufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getNamedBlobFilename(input: Blob | ArrayBuffer | ArrayBufferView) {
  if (!(input instanceof Blob)) {
    return undefined;
  }

  const candidate = input as Blob & { name?: string };
  return typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : undefined;
}

function sanitizeFilename(filename: string) {
  return filename
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function getDefaultObjectKey(input: {
  filename: string;
  serviceNamespaceId: string;
  tenantId?: string;
}) {
  const scopePath = input.tenantId
    ? `${input.serviceNamespaceId}/${input.tenantId}`
    : `${input.serviceNamespaceId}/global`;

  return `staging/${scopePath}/${crypto.randomUUID()}-${sanitizeFilename(input.filename)}`;
}

function getUploadIdempotencyKeys(baseIdempotencyKey?: string) {
  const base = baseIdempotencyKey ?? `sdk-upload-${crypto.randomUUID()}`;

  return {
    completeIdempotencyKey: `${base}:complete`,
    createIdempotencyKey: `${base}:create`
  };
}

function mergeWaitOptions(
  defaults?: WaitForVersionOptions,
  overrides?: WaitForVersionOptions
): WaitForVersionOptions | undefined {
  if (!defaults && !overrides) {
    return undefined;
  }

  return {
    ...(defaults ?? {}),
    ...(overrides ?? {})
  };
}

function resolveScopedRequiredValue<T>(
  value: T | undefined,
  fallback: T | undefined,
  fieldName: 'assetOwner' | 'serviceNamespaceId'
): T {
  if (value !== undefined) {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(
    `${fieldName} is required. Provide it in createCDNgineClient(...).withDefaults(...) or on the individual upload call.`
  );
}

async function normalizeUploadPayload(
  input: Blob | ArrayBuffer | ArrayBufferView
): Promise<{
  body: UploadBinaryPayload;
  byteLength: number;
  bytes: ArrayBuffer;
}> {
  if (input instanceof Blob) {
    return {
      body: input,
      byteLength: input.size,
      bytes: await input.arrayBuffer()
    };
  }

  if (input instanceof ArrayBuffer) {
    return {
      body: input,
      byteLength: input.byteLength,
      bytes: input
    };
  }

  const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const bytes = view.slice().buffer;

  return {
    body: view,
    byteLength: input.byteLength,
    bytes
  };
}

type XmlHttpRequestProgressEvent = {
  lengthComputable: boolean;
  loaded: number;
  total: number;
};

type XmlHttpRequestLike = {
  abort(): void;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  open(method: string, url: string): void;
  send(body: UploadBinaryPayload): void;
  setRequestHeader(name: string, value: string): void;
  status: number;
  upload: {
    onprogress: ((event: XmlHttpRequestProgressEvent) => void) | null;
  };
};

function getXmlHttpRequestConstructor():
  | (new () => XmlHttpRequestLike)
  | undefined {
  const candidate = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

  return typeof candidate === 'function'
    ? (candidate as new () => XmlHttpRequestLike)
    : undefined;
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
  private readonly getHeaders:
    | (() => Record<string, string> | Promise<Record<string, string> | undefined> | undefined)
    | undefined;
  private readonly getAccessToken: (() => string | Promise<string> | undefined) | undefined;
  readonly assets: {
    byId: (assetId: string) => CDNgineAssetClient;
    get: (assetId: string) => Promise<GetAssetResponse>;
    upload: (input: UploadAssetInput) => Promise<UploadAssetResult>;
    uploadAndWait: (input: UploadAssetAndWaitInput) => Promise<UploadAssetAndWaitResult>;
    uploadFile: (input: UploadFileInput) => Promise<UploadFileResult>;
    uploadFileAndWait: (input: UploadFileAndWaitInput) => Promise<UploadFileAndWaitResult>;
    version: (assetId: string, versionId: string) => CDNgineAssetVersionClient;
    waitForVersion: (
      assetId: string,
      versionId: string,
      options?: WaitForVersionOptions
    ) => Promise<GetAssetVersionResponse>;
  };
  readonly deliveries: {
    authorize: (input: AuthorizeDeliveryInput) => Promise<AuthorizeDeliveryResponse>;
  };
  readonly manifests: {
    get: (assetId: string, versionId: string, manifestType: string) => Promise<GetManifestResponse>;
  };
  readonly sources: {
    authorizeDownload: (input: AuthorizeSourceDownloadInput) => Promise<AuthorizeSourceResponse>;
  };

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

    if (typeof options.getHeaders === 'function') {
      this.getHeaders = options.getHeaders;
    } else if (options.getHeaders) {
      const headers = options.getHeaders;
      this.getHeaders = () => headers;
    }

    this.assets = {
      byId: (assetId) => this.asset(assetId),
      get: (assetId) => this.getAsset(assetId),
      upload: (input) => this.uploadAsset(input),
      uploadAndWait: (input) => this.uploadAssetAndWait(input),
      uploadFile: (input) => this.uploadFile(input),
      uploadFileAndWait: (input) => this.uploadFileAndWait(input),
      version: (assetId, versionId) => new CDNgineAssetVersionClient(this, assetId, versionId),
      waitForVersion: (assetId, versionId, waitOptions) =>
        this.waitForVersion(assetId, versionId, waitOptions)
    };
    this.deliveries = {
      authorize: (input) => this.authorizeDelivery(input)
    };
    this.manifests = {
      get: (assetId, versionId, manifestType) => this.getManifest(assetId, versionId, manifestType)
    };
    this.sources = {
      authorizeDownload: (input) => this.authorizeSourceDownload(input)
    };
  }

  asset(assetId: string) {
    return new CDNgineAssetClient(this, assetId);
  }

  scope(defaults: CDNgineClientDefaults) {
    return new CDNgineScopedClient(this, defaults);
  }

  withDefaults(defaults: CDNgineClientDefaults) {
    return this.scope(defaults);
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

  async getAsset(assetId: string): Promise<GetAssetResponse> {
    return this.requestJson<GetAssetResponse>({
      method: 'GET',
      pathname: `/v1/assets/${assetId}`
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

  async uploadAsset(input: UploadAssetInput): Promise<UploadAssetResult> {
    const session = await this.createUploadSession(input.create);
    const completion = await this.completeUploadSession({
      ...input.complete,
      uploadSessionId: session.uploadSessionId
    });

    return {
      assetId: completion.assetId,
      completion,
      session,
      uploadSessionId: session.uploadSessionId,
      versionId: completion.versionId
    };
  }

  async uploadAssetAndWait(input: UploadAssetAndWaitInput): Promise<UploadAssetAndWaitResult> {
    const upload = await this.uploadAsset(input);
    const version = await this.waitForVersion(upload.assetId, upload.versionId, input.wait);

    return {
      ...upload,
      version
    };
  }

  async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
    const normalizedPayload = await normalizeUploadPayload(input.file);
    const filename = input.filename ?? getNamedBlobFilename(input.file);

    if (!filename) {
      throw new Error(
        'filename is required when uploadFile() receives bytes that do not carry a file name.'
      );
    }

    const checksum = {
      algorithm: 'sha256' as const,
      value: bufferToHex(await crypto.subtle.digest('SHA-256', normalizedPayload.bytes))
    };
    const contentType =
      input.contentType ??
      (input.file instanceof Blob && input.file.type.length > 0
        ? input.file.type
        : 'application/octet-stream');
    const objectKey =
      input.objectKey ??
      getDefaultObjectKey({
        filename,
        serviceNamespaceId: input.serviceNamespaceId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {})
      });
    const idempotencyKeys = getUploadIdempotencyKeys(input.idempotencyKey);
    const session = await this.createUploadSession({
      body: {
        ...(input.assetId ? { assetId: input.assetId } : {}),
        assetOwner: input.assetOwner,
        serviceNamespaceId: input.serviceNamespaceId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        source: {
          contentType,
          filename
        },
        upload: {
          byteLength: normalizedPayload.byteLength,
          checksum,
          objectKey
        }
      },
      idempotencyKey: idempotencyKeys.createIdempotencyKey
    });

    await this.uploadToTarget({
      body: normalizedPayload.body,
      ...(input.onUploadProgress ? { onUploadProgress: input.onUploadProgress } : {}),
      uploadTarget: session.uploadTarget
    });

    const completion = await this.completeUploadSession({
      body: {
        stagedObject: {
          byteLength: normalizedPayload.byteLength,
          checksum,
          objectKey
        }
      },
      idempotencyKey: idempotencyKeys.completeIdempotencyKey,
      uploadSessionId: session.uploadSessionId
    });

    return {
      assetId: completion.assetId,
      checksum,
      completion,
      objectKey,
      session,
      uploadSessionId: session.uploadSessionId,
      versionId: completion.versionId
    };
  }

  async uploadFileAndWait(input: UploadFileAndWaitInput): Promise<UploadFileAndWaitResult> {
    const upload = await this.uploadFile(input);
    const version = await this.waitForVersion(upload.assetId, upload.versionId, input.wait);

    return {
      ...upload,
      version
    };
  }

  private async uploadToTarget(input: {
    body: UploadBinaryPayload;
    onUploadProgress?: (progress: number) => void;
    uploadTarget: CreateUploadSessionResponse['uploadTarget'];
  }) {
    if (input.uploadTarget.protocol !== 'tus') {
      throw new Error(
        `Unsupported upload target protocol "${input.uploadTarget.protocol}".`
      );
    }

    const xhrConstructor = input.onUploadProgress ? getXmlHttpRequestConstructor() : undefined;

    if (xhrConstructor) {
      await new Promise<void>((resolve, reject) => {
        const request = new xhrConstructor();

        request.open(input.uploadTarget.method, input.uploadTarget.url);
        request.setRequestHeader('Content-Type', 'application/offset+octet-stream');
        request.setRequestHeader('Tus-Resumable', '1.0.0');
        request.setRequestHeader('Upload-Offset', '0');
        request.upload.onprogress = (event) => {
          if (!event.lengthComputable) {
            return;
          }

          input.onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
        };
        request.onload = () => {
          if (request.status >= 200 && request.status < 300) {
            input.onUploadProgress?.(100);
            resolve();
            return;
          }

          reject(
            new Error(
              `Upload target rejected the staged upload with status ${request.status}.`
            )
          );
        };
        request.onerror = () => {
          reject(new Error('Upload target request failed.'));
        };
        request.send(input.body);
      });

      return;
    }

    input.onUploadProgress?.(0);

    const response = await this.fetchImpl(input.uploadTarget.url, {
      body: input.body,
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0'
      },
      method: input.uploadTarget.method
    });

    if (!response.ok) {
      throw new Error(
        `Upload target rejected the staged upload with status ${response.status}.`
      );
    }

    input.onUploadProgress?.(100);
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

    const extraHeaders = await this.getHeaders?.();

    for (const [name, value] of Object.entries(extraHeaders ?? {})) {
      headers.set(name, value);
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

export class CDNgineScopedClient {
  readonly assets: {
    byId: (assetId: string) => CDNgineAssetClient;
    get: (assetId: string) => Promise<GetAssetResponse>;
    upload: (
      file: Blob | ArrayBuffer | ArrayBufferView,
      options?: ScopedUploadOptions
    ) => Promise<UploadFileAndWaitResult>;
    uploadFile: (
      file: Blob | ArrayBuffer | ArrayBufferView,
      options?: ScopedUploadFileOptions
    ) => Promise<UploadFileResult>;
    version: (assetId: string, versionId: string) => CDNgineAssetVersionClient;
    waitForVersion: (
      assetId: string,
      versionId: string,
      options?: WaitForVersionOptions
    ) => Promise<GetAssetVersionResponse>;
  };

  constructor(
    private readonly client: CDNginePublicClient,
    readonly defaults: CDNgineClientDefaults
  ) {
    this.assets = {
      byId: (assetId) => this.asset(assetId),
      get: (assetId) => this.client.getAsset(assetId),
      upload: (file, options) => this.upload(file, options),
      uploadFile: (file, options) => this.uploadFile(file, options),
      version: (assetId, versionId) => new CDNgineAssetVersionClient(this.client, assetId, versionId),
      waitForVersion: (assetId, versionId, waitOptions) =>
        this.client.waitForVersion(assetId, versionId, waitOptions)
    };
  }

  asset(assetId: string) {
    return this.client.asset(assetId);
  }

  scope(defaults: CDNgineClientDefaults) {
    return this.withDefaults(defaults);
  }

  withDefaults(defaults: CDNgineClientDefaults) {
    const mergedDefaults: CDNgineClientDefaults = {
      ...this.defaults,
      ...defaults
    };
    const wait = mergeWaitOptions(this.defaults.wait, defaults.wait);

    return new CDNgineScopedClient(this.client, {
      ...mergedDefaults,
      ...(wait ? { wait } : {})
    });
  }

  async upload(
    file: Blob | ArrayBuffer | ArrayBufferView,
    options: ScopedUploadOptions = {}
  ): Promise<UploadFileAndWaitResult> {
    const input = this.buildUploadInput(file, options);

    return this.client.uploadFileAndWait(input);
  }

  async uploadFile(
    file: Blob | ArrayBuffer | ArrayBufferView,
    options: ScopedUploadFileOptions = {}
  ): Promise<UploadFileResult> {
    const input = this.buildUploadFileInput(file, options);

    return this.client.uploadFile(input);
  }

  private buildUploadFileInput(
    file: Blob | ArrayBuffer | ArrayBufferView,
    options: ScopedUploadFileOptions
  ): UploadFileInput {
    const assetOwner = resolveScopedRequiredValue(
      options.assetOwner,
      this.defaults.assetOwner,
      'assetOwner'
    );
    const serviceNamespaceId = resolveScopedRequiredValue(
      options.serviceNamespaceId,
      this.defaults.serviceNamespaceId,
      'serviceNamespaceId'
    );
    const tenantId = options.tenantId ?? this.defaults.tenantId;

    return {
      ...options,
      assetOwner,
      file,
      serviceNamespaceId,
      ...(tenantId !== undefined ? { tenantId } : {})
    };
  }

  private buildUploadInput(
    file: Blob | ArrayBuffer | ArrayBufferView,
    options: ScopedUploadOptions
  ): UploadFileAndWaitInput {
    const { wait: waitOverrides, ...uploadOptions } = options;
    const wait = mergeWaitOptions(this.defaults.wait, waitOverrides);
    const input = this.buildUploadFileInput(file, uploadOptions);

    return {
      ...input,
      ...(wait ? { wait } : {})
    };
  }
}

export class CDNgineAssetClient {
  constructor(
    private readonly client: CDNginePublicClient,
    private readonly assetId: string
  ) {}

  get(): Promise<GetAssetResponse> {
    return this.client.getAsset(this.assetId);
  }

  version(versionId: string) {
    return new CDNgineAssetVersionClient(this.client, this.assetId, versionId);
  }
}

export class CDNgineAssetVersionClient {
  constructor(
    private readonly client: CDNginePublicClient,
    readonly assetId: string,
    readonly versionId: string
  ) {}

  authorizeSourceDownload(
    input: AuthorizeSourceDownloadForVersionInput
  ): Promise<AuthorizeSourceResponse> {
    return this.client.authorizeSourceDownload({
      ...input,
      assetId: this.assetId,
      versionId: this.versionId
    });
  }

  source() {
    return {
      authorize: (input: AuthorizeSourceDownloadForVersionInput) =>
        this.authorizeSourceDownload(input),
      url: async (input: SourceUrlForVersionInput) => {
        const authorization = await this.authorizeSourceDownload({
          body: {
            ...(input.preferredDisposition
              ? { preferredDisposition: input.preferredDisposition }
              : {})
          },
          idempotencyKey: input.idempotencyKey
        });

        return getAuthorizedUrl(authorization, 'Source download');
      }
    };
  }

  delivery(deliveryScopeId: string) {
    return {
      authorize: (input: AuthorizeDeliveryForVersionInput) =>
        this.client.authorizeDelivery({
          ...input,
          assetId: this.assetId,
          deliveryScopeId,
          versionId: this.versionId
        }),
      url: async (input: DeliveryUrlForVersionInput) => {
        const authorization = await this.client.authorizeDelivery({
          assetId: this.assetId,
          body: {
            responseFormat: 'url',
            variant: input.variant
          },
          deliveryScopeId,
          idempotencyKey: input.idempotencyKey,
          versionId: this.versionId
        });

        return getAuthorizedUrl(authorization, 'Delivery authorization');
      }
    };
  }

  get(): Promise<GetAssetVersionResponse> {
    return this.client.getAssetVersion(this.assetId, this.versionId);
  }

  listDerivatives(): Promise<ListDerivativesResponse> {
    return this.client.listDerivatives(this.assetId, this.versionId);
  }

  manifest(manifestType: string) {
    return {
      get: () => this.client.getManifest(this.assetId, this.versionId, manifestType)
    };
  }

  wait(options?: WaitForVersionOptions): Promise<GetAssetVersionResponse> {
    return this.client.waitForVersion(this.assetId, this.versionId, options);
  }
}

export function createCDNgineClient(options: CDNgineClientOptions) {
  return new CDNginePublicClient(options);
}

function getAuthorizedUrl(
  authorization: AuthorizeDeliveryResponse | AuthorizeSourceResponse,
  operationName: string
) {
  if (typeof authorization.url !== 'string' || authorization.url.length === 0) {
    throw new Error(
      `${operationName} did not return a URL. Use authorize(...) when the delivery mode requires cookies, an internal handle, or another non-URL response.`
    );
  }

  return authorization.url;
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
  GetAssetResponse,
  GetAssetVersionResponse,
  GetManifestResponse,
  ListDerivativesResponse
};
