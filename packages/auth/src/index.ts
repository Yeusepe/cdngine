/**
 * Purpose: Defines CDNgine's pluggable bearer-token auth contract and ships the repository's default Better Auth adapter plus in-memory fixtures for tests and demos.
 * Governing docs:
 * - docs/security-model.md
 * - docs/service-architecture.md
 * - docs/package-reference.md
 * External references:
 * - https://datatracker.ietf.org/doc/html/rfc6750
 * - https://datatracker.ietf.org/doc/html/rfc8725
 * - https://nodejs.org/api/crypto.html
 * - https://www.better-auth.com/docs/concepts/session-management
 * - https://www.better-auth.com/docs/plugins/bearer
 * - https://www.better-auth.com/docs/concepts/database
 * Tests:
 * - packages/auth/test/auth.test.mjs
 * - apps/api/test/api-app.test.mjs
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { bearer } from 'better-auth/plugins/bearer';
import { customSession } from 'better-auth/plugins/custom-session';

export const authPackageName = '@cdngine/auth';

export interface AuthenticatedActor {
  subject: string;
  roles: string[];
  allowedServiceNamespaces: string[];
  allowedTenantIds: string[];
}

export interface ResolveActorInput {
  sessionId: string;
  userEmail: string;
  userId: string;
  userName: string;
}

export interface ResolvedActorDescriptor extends Partial<AuthenticatedActor> {
  subject?: string;
}

export interface RequestActorAuthenticator {
  authenticateHeaders(headers: Headers | Record<string, string>): Promise<AuthenticatedActor | null>;
}

export type AuthenticateHeadersHandler = (
  headers: Headers
) => Promise<AuthenticatedActor | null> | AuthenticatedActor | null;

export interface CreateRequestActorAuthenticatorOptions {
  authenticateHeaders: AuthenticateHeadersHandler;
}

export interface StaticServiceAccountRegistration extends ResolvedActorDescriptor {
  allowedServiceNamespaces?: string[];
  allowedTenantIds?: string[];
  roles?: string[];
  subject: string;
  tokenSha256: string;
}

export interface StaticServiceAccountRuntimeConfig {
  serviceAccounts: StaticServiceAccountRegistration[];
}

export interface CDNgineBetterAuthApi {
  getSession(input: { headers: Headers }): Promise<unknown>;
  signInEmail(input: {
    body: {
      email: string;
      password: string;
      rememberMe?: boolean;
    };
    headers: Headers;
  }): Promise<{
    token: string;
  }>;
  signUpEmail(input: {
    body: {
      email: string;
      name: string;
      password: string;
    };
    headers: Headers;
  }): Promise<unknown>;
}

export interface CDNgineAuthService extends RequestActorAuthenticator {
  auth: {
    api: CDNgineBetterAuthApi;
  };
}

export interface CreateCDNgineAuthOptions {
  baseURL: string;
  database: BetterAuthOptions['database'];
  betterAuthOptions?: Omit<BetterAuthOptions, 'baseURL' | 'database' | 'plugins' | 'secret'>;
  plugins?: BetterAuthPlugin[];
  resolveActor?: (input: ResolveActorInput) => Promise<ResolvedActorDescriptor | null | undefined> | ResolvedActorDescriptor | null | undefined;
  secret: string;
}

export interface InMemoryPrincipalRegistration extends ResolvedActorDescriptor {
  allowedServiceNamespaces?: string[];
  allowedTenantIds?: string[];
  email: string;
  name?: string;
  password?: string;
  roles?: string[];
}

export interface ProvisionedPrincipal {
  actor: AuthenticatedActor;
  email: string;
  token: string;
}

export interface InMemoryCDNgineAuth extends CDNgineAuthService {
  provisionPrincipal(principal: InMemoryPrincipalRegistration): Promise<ProvisionedPrincipal>;
}

interface CDNgineSessionView {
  allowedServiceNamespaces?: string[];
  allowedTenantIds?: string[];
  roles?: string[];
  subject?: string;
  user: {
    email: string;
    id: string;
  };
}

const DEFAULT_TEST_AUTH_BASE_URL = 'http://localhost';
const DEFAULT_TEST_AUTH_SECRET =
  'cdngine-test-auth-secret-cdngine-test-auth-secret-cdngine-test-auth-secret';
const DEFAULT_TEST_PASSWORD = 'cdngine-demo-password-123';

export interface BetterAuthRuntimeConfig {
  baseURL: string;
  secret: string;
  session: {
    deferSessionRefresh: boolean;
    disableSessionRefresh: boolean;
    expiresInSeconds: number;
    freshAgeSeconds: number;
    updateAgeSeconds: number;
  };
  trustedOrigins: string[];
}

export class BetterAuthRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BetterAuthRuntimeConfigError';
  }
}

export class StaticServiceAccountConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaticServiceAccountConfigError';
  }
}

interface NormalizedStaticServiceAccount {
  actor: AuthenticatedActor;
  tokenDigest: Buffer;
  tokenSha256: string;
}

function toHeaders(headers: Headers | Record<string, string>): Headers {
  return headers instanceof Headers ? headers : new Headers(headers);
}

function readOptionalRuntimeValue(environment: NodeJS.ProcessEnv, key: string): string | null {
  const value = environment[key]?.trim();

  return value ? value : null;
}

function normalizeStringArray(values: readonly string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeActorDescriptor(
  descriptor: ResolvedActorDescriptor | null | undefined,
  defaultSubject: string
): AuthenticatedActor {
  return {
    subject: descriptor?.subject?.trim() || defaultSubject,
    roles: normalizeStringArray(descriptor?.roles),
    allowedServiceNamespaces: normalizeStringArray(descriptor?.allowedServiceNamespaces),
    allowedTenantIds: normalizeStringArray(descriptor?.allowedTenantIds)
  };
}

function readRequiredRuntimeValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();

  if (!value) {
    throw new BetterAuthRuntimeConfigError(`${key} is required for runtime auth configuration.`);
  }

  return value;
}

function readPositiveIntegerRuntimeValue(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number
): number {
  const rawValue = environment[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BetterAuthRuntimeConfigError(`${key} must be a positive integer. Received "${rawValue}".`);
  }

  return parsed;
}

function readBooleanRuntimeValue(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean
): boolean {
  const rawValue = environment[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  throw new BetterAuthRuntimeConfigError(`${key} must be "true" or "false". Received "${rawValue}".`);
}

function readJsonStringArray(environment: NodeJS.ProcessEnv, key: string): string[] {
  const rawValue = environment[key]?.trim();

  if (!rawValue) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse failure.';
    throw new BetterAuthRuntimeConfigError(`${key} must be a JSON array of strings: ${message}`);
  }

  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
    throw new BetterAuthRuntimeConfigError(`${key} must be a JSON array of non-empty strings.`);
  }

  return [...new Set(parsed.map((value) => value.trim()))];
}

export function buildBearerHeaders(token: string, headers: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...headers
  };
}

export function extractBearerToken(
  headers: Headers | Record<string, string>,
  scheme = 'Bearer'
): string | null {
  const authorization = toHeaders(headers).get('authorization');

  if (!authorization) {
    return null;
  }

  const trimmed = authorization.trim();
  const separatorIndex = trimmed.indexOf(' ');

  if (separatorIndex <= 0) {
    return null;
  }

  const headerScheme = trimmed.slice(0, separatorIndex);
  const token = trimmed.slice(separatorIndex + 1).trim();

  if (headerScheme.toLowerCase() !== scheme.toLowerCase() || token.length === 0) {
    return null;
  }

  return token;
}

function assertStaticServiceAccountSubject(
  account: StaticServiceAccountRegistration,
  index: number
): string {
  const subject = account.subject?.trim();

  if (!subject) {
    throw new StaticServiceAccountConfigError(
      `CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON[${index}].subject must be a non-empty string.`
    );
  }

  return subject;
}

function assertStaticServiceAccountTokenHash(
  account: StaticServiceAccountRegistration,
  index: number
): string {
  const tokenSha256 = account.tokenSha256?.trim().toLowerCase();

  if (!tokenSha256 || !/^[a-f0-9]{64}$/.test(tokenSha256)) {
    throw new StaticServiceAccountConfigError(
      `CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON[${index}].tokenSha256 must be a 64-character SHA-256 hex digest.`
    );
  }

  return tokenSha256;
}

function normalizeStaticServiceAccount(
  account: StaticServiceAccountRegistration,
  index: number
): NormalizedStaticServiceAccount {
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw new StaticServiceAccountConfigError(
      `CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON[${index}] must be a service-account object.`
    );
  }

  const subject = assertStaticServiceAccountSubject(account, index);
  const tokenSha256 = assertStaticServiceAccountTokenHash(account, index);

  return {
    actor: normalizeActorDescriptor(account, subject),
    tokenDigest: Buffer.from(tokenSha256, 'hex'),
    tokenSha256
  };
}

function assertUniqueStaticServiceAccountTokenHashes(
  normalizedAccounts: readonly NormalizedStaticServiceAccount[]
) {
  const uniqueTokenHashes = new Set(normalizedAccounts.map((account) => account.tokenSha256));

  if (uniqueTokenHashes.size !== normalizedAccounts.length) {
    throw new StaticServiceAccountConfigError(
      'CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON contains duplicate tokenSha256 entries.'
    );
  }
}

function readStaticServiceAccountListValue(
  environment: NodeJS.ProcessEnv,
  key: string
): string[] {
  const rawValue = readOptionalRuntimeValue(environment, key);

  if (!rawValue) {
    return [];
  }

  return [
    ...new Set(
      rawValue
        .split(/[|,]/u)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  ];
}

function hasSingleStaticServiceAccountEnvironment(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(
    readOptionalRuntimeValue(environment, 'CDNGINE_SERVICE_ACCOUNT_SUBJECT') ||
      readOptionalRuntimeValue(environment, 'CDNGINE_SERVICE_ACCOUNT_TOKEN_SHA256') ||
      readOptionalRuntimeValue(environment, 'CDNGINE_SERVICE_ACCOUNT_ROLES') ||
      readOptionalRuntimeValue(environment, 'CDNGINE_SERVICE_ACCOUNT_ALLOWED_SERVICE_NAMESPACES') ||
      readOptionalRuntimeValue(environment, 'CDNGINE_SERVICE_ACCOUNT_ALLOWED_TENANT_IDS')
  );
}

function loadSingleStaticServiceAccountFromEnvironment(
  environment: NodeJS.ProcessEnv
): StaticServiceAccountRegistration | null {
  if (!hasSingleStaticServiceAccountEnvironment(environment)) {
    return null;
  }

  const subject = readOptionalRuntimeValue(environment, 'CDNGINE_SERVICE_ACCOUNT_SUBJECT');
  const tokenSha256 = readOptionalRuntimeValue(
    environment,
    'CDNGINE_SERVICE_ACCOUNT_TOKEN_SHA256'
  );

  if (!subject || !tokenSha256) {
    throw new StaticServiceAccountConfigError(
      'CDNGINE_SERVICE_ACCOUNT_SUBJECT and CDNGINE_SERVICE_ACCOUNT_TOKEN_SHA256 are required when using single service-account env keys.'
    );
  }

  const account: StaticServiceAccountRegistration = {
    allowedServiceNamespaces: readStaticServiceAccountListValue(
      environment,
      'CDNGINE_SERVICE_ACCOUNT_ALLOWED_SERVICE_NAMESPACES'
    ),
    allowedTenantIds: readStaticServiceAccountListValue(
      environment,
      'CDNGINE_SERVICE_ACCOUNT_ALLOWED_TENANT_IDS'
    ),
    roles: readStaticServiceAccountListValue(environment, 'CDNGINE_SERVICE_ACCOUNT_ROLES'),
    subject,
    tokenSha256
  };

  const normalizedAccount = normalizeStaticServiceAccount(account, 0);

  return {
    ...normalizedAccount.actor,
    tokenSha256: normalizedAccount.tokenSha256
  };
}

export function hashBearerTokenForServiceAccount(token: string): string {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new StaticServiceAccountConfigError('Bearer token material must be a non-empty string.');
  }

  return createHash('sha256').update(normalizedToken, 'utf8').digest('hex');
}

export function createStaticServiceAccountAuthenticator(
  serviceAccounts: readonly StaticServiceAccountRegistration[]
): RequestActorAuthenticator {
  if (!Array.isArray(serviceAccounts) || serviceAccounts.length === 0) {
    throw new StaticServiceAccountConfigError(
      'At least one static service account is required for service-account auth.'
    );
  }

  const normalizedAccounts = serviceAccounts.map((account, index) =>
    normalizeStaticServiceAccount(account, index)
  );

  assertUniqueStaticServiceAccountTokenHashes(normalizedAccounts);

  return {
    async authenticateHeaders(headers) {
      const token = extractBearerToken(headers);

      if (!token) {
        return null;
      }

      const incomingDigest = Buffer.from(hashBearerTokenForServiceAccount(token), 'hex');

      for (const account of normalizedAccounts) {
        if (timingSafeEqual(incomingDigest, account.tokenDigest)) {
          return {
            allowedServiceNamespaces: [...account.actor.allowedServiceNamespaces],
            allowedTenantIds: [...account.actor.allowedTenantIds],
            roles: [...account.actor.roles],
            subject: account.actor.subject
          };
        }
      }

      return null;
    }
  };
}

export function loadStaticServiceAccountRuntimeConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): StaticServiceAccountRuntimeConfig {
  const rawValue = readOptionalRuntimeValue(environment, 'CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON');
  const singleAccount = loadSingleStaticServiceAccountFromEnvironment(environment);

  if (rawValue && singleAccount) {
    throw new StaticServiceAccountConfigError(
      'Use either CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON or the single CDNGINE_SERVICE_ACCOUNT_* variables, not both.'
    );
  }

  if (!rawValue) {
    return {
      serviceAccounts: singleAccount ? [singleAccount] : []
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse failure.';
    throw new StaticServiceAccountConfigError(
      `CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON must be a JSON array of service-account objects: ${message}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new StaticServiceAccountConfigError(
      'CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON must be a JSON array of service-account objects.'
    );
  }

  const serviceAccounts = parsed.map((account, index) =>
    normalizeStaticServiceAccount(account as StaticServiceAccountRegistration, index)
  );

  assertUniqueStaticServiceAccountTokenHashes(serviceAccounts);

  return {
    serviceAccounts: serviceAccounts.map((account) => ({
      allowedServiceNamespaces: [...account.actor.allowedServiceNamespaces],
      allowedTenantIds: [...account.actor.allowedTenantIds],
      roles: [...account.actor.roles],
      subject: account.actor.subject,
      tokenSha256: account.tokenSha256
    }))
  };
}

export function createStaticServiceAccountAuthenticatorFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): RequestActorAuthenticator {
  const runtime = loadStaticServiceAccountRuntimeConfigFromEnvironment(environment);

  if (runtime.serviceAccounts.length === 0) {
    throw new StaticServiceAccountConfigError(
      'CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON is required for service-account auth.'
    );
  }

  return createStaticServiceAccountAuthenticator(runtime.serviceAccounts);
}

export function createRequestActorAuthenticator(
  options: CreateRequestActorAuthenticatorOptions | AuthenticateHeadersHandler
): RequestActorAuthenticator {
  const authenticateHeaders =
    typeof options === 'function' ? options : options.authenticateHeaders;

  return {
    async authenticateHeaders(headers) {
      return authenticateHeaders(toHeaders(headers));
    }
  };
}

export function createCDNgineAuth(options: CreateCDNgineAuthOptions): CDNgineAuthService {
  const resolveActor =
    options.resolveActor ??
    ((input: ResolveActorInput) => ({
      subject: input.userId
    }));
  const basePlugins = [...(options.plugins ?? [])];
  const authOptions = {
    ...(options.betterAuthOptions ?? {}),
    baseURL: options.baseURL,
    database: options.database,
    emailAndPassword: {
      enabled: true,
      ...(options.betterAuthOptions?.emailAndPassword ?? {})
    },
    secret: options.secret
  } satisfies BetterAuthOptions;
  const auth = betterAuth({
    ...authOptions,
    plugins: [
      ...basePlugins,
      bearer(),
      customSession(
        async ({ user, session }) => {
          const actor = normalizeActorDescriptor(
            await resolveActor({
              sessionId: session.id,
              userEmail: user.email,
              userId: user.id,
              userName: user.name
            }),
            user.id
          );

          return {
            allowedServiceNamespaces: actor.allowedServiceNamespaces,
            allowedTenantIds: actor.allowedTenantIds,
            roles: actor.roles,
            session,
            subject: actor.subject,
            user
          };
        },
        authOptions
      )
    ]
  });

  return {
    auth,
    async authenticateHeaders(headers) {
      const session = (await auth.api.getSession({
        headers: toHeaders(headers)
      })) as CDNgineSessionView | null;

      if (!session) {
        return null;
      }

      const resolvedDescriptor: ResolvedActorDescriptor = {};

      if (session.subject) {
        resolvedDescriptor.subject = session.subject;
      }
      if (session.roles) {
        resolvedDescriptor.roles = session.roles;
      }
      if (session.allowedServiceNamespaces) {
        resolvedDescriptor.allowedServiceNamespaces = session.allowedServiceNamespaces;
      }
      if (session.allowedTenantIds) {
        resolvedDescriptor.allowedTenantIds = session.allowedTenantIds;
      }

      return normalizeActorDescriptor(
        resolvedDescriptor,
        session.user.id
      );
    }
  };
}

export const createBetterAuthAuthenticator = createCDNgineAuth;

export function loadBetterAuthRuntimeConfigFromEnvironment(
  environment: NodeJS.ProcessEnv
): BetterAuthRuntimeConfig {
  return {
    baseURL: readRequiredRuntimeValue(environment, 'CDNGINE_AUTH_BASE_URL'),
    secret: readRequiredRuntimeValue(environment, 'CDNGINE_AUTH_SECRET'),
    session: {
      deferSessionRefresh: readBooleanRuntimeValue(
        environment,
        'CDNGINE_AUTH_DEFER_SESSION_REFRESH',
        true
      ),
      disableSessionRefresh: readBooleanRuntimeValue(
        environment,
        'CDNGINE_AUTH_DISABLE_SESSION_REFRESH',
        false
      ),
      expiresInSeconds: readPositiveIntegerRuntimeValue(
        environment,
        'CDNGINE_AUTH_SESSION_EXPIRES_IN_SECONDS',
        60 * 60 * 24 * 7
      ),
      freshAgeSeconds: readPositiveIntegerRuntimeValue(
        environment,
        'CDNGINE_AUTH_SESSION_FRESH_AGE_SECONDS',
        60 * 5
      ),
      updateAgeSeconds: readPositiveIntegerRuntimeValue(
        environment,
        'CDNGINE_AUTH_SESSION_UPDATE_AGE_SECONDS',
        60 * 60 * 24
      )
    },
    trustedOrigins: readJsonStringArray(environment, 'CDNGINE_AUTH_TRUSTED_ORIGINS_JSON')
  };
}

export function createCDNgineAuthFromEnvironment(
  options: Omit<CreateCDNgineAuthOptions, 'baseURL' | 'secret'>,
  environment: NodeJS.ProcessEnv = process.env
): CDNgineAuthService {
  const runtime = loadBetterAuthRuntimeConfigFromEnvironment(environment);

  return createCDNgineAuth({
    ...options,
    baseURL: runtime.baseURL,
    betterAuthOptions: {
      ...(options.betterAuthOptions ?? {}),
      session: {
        ...(options.betterAuthOptions?.session ?? {}),
        deferSessionRefresh: runtime.session.deferSessionRefresh,
        disableSessionRefresh: runtime.session.disableSessionRefresh,
        expiresIn: runtime.session.expiresInSeconds,
        freshAge: runtime.session.freshAgeSeconds,
        updateAge: runtime.session.updateAgeSeconds
      },
      trustedOrigins: runtime.trustedOrigins
    },
    secret: runtime.secret
  });
}

export function createInMemoryCDNgineAuth(
  options: Partial<Omit<CreateCDNgineAuthOptions, 'database' | 'resolveActor'>> = {}
): InMemoryCDNgineAuth {
  const principalByEmail = new Map<string, InMemoryPrincipalRegistration>();
  const registeredEmails = new Set<string>();
  const memoryDb: MemoryDB = {
    account: [],
    session: [],
    user: [],
    verification: []
  };
  const service = createCDNgineAuth({
    ...options,
    baseURL: options.baseURL ?? DEFAULT_TEST_AUTH_BASE_URL,
    database: memoryAdapter(memoryDb),
    resolveActor(input) {
      const principal = principalByEmail.get(input.userEmail);

      return normalizeActorDescriptor(principal, principal?.subject?.trim() || input.userId);
    },
    secret: options.secret ?? DEFAULT_TEST_AUTH_SECRET
  });
  const jsonHeaders = new Headers({
    'content-type': 'application/json'
  });

  return {
    ...service,
    async provisionPrincipal(principal) {
      const email = principal.email.trim().toLowerCase();
      const name = principal.name?.trim() || email;
      const password = principal.password ?? DEFAULT_TEST_PASSWORD;
      const subject = principal.subject?.trim() || email;
      const normalizedPrincipal: InMemoryPrincipalRegistration = {
        ...principal,
        allowedServiceNamespaces: normalizeStringArray(principal.allowedServiceNamespaces),
        allowedTenantIds: normalizeStringArray(principal.allowedTenantIds),
        email,
        name,
        password,
        roles: normalizeStringArray(principal.roles),
        subject
      };

      principalByEmail.set(normalizedPrincipal.email, normalizedPrincipal);

      if (!registeredEmails.has(normalizedPrincipal.email)) {
        await service.auth.api.signUpEmail({
          body: {
            email,
            name,
            password
          },
          headers: jsonHeaders
        });
        registeredEmails.add(normalizedPrincipal.email);
      }

      const session = await service.auth.api.signInEmail({
        body: {
          email,
          password,
          rememberMe: false
        },
        headers: jsonHeaders
      });

      return {
        actor: normalizeActorDescriptor(normalizedPrincipal, subject),
        email,
        token: session.token
      };
    }
  };
}

export const createInMemoryBetterAuthAuthenticator = createInMemoryCDNgineAuth;
