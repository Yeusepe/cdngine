/**
 * Purpose: Defines CDNgine's pluggable bearer-token auth contract and ships the repository's default Better Auth adapter plus in-memory fixtures for tests and demos.
 * Governing docs:
 * - docs/security-model.md
 * - docs/service-architecture.md
 * - docs/package-reference.md
 * External references:
 * - https://datatracker.ietf.org/doc/html/rfc6750
 * - https://datatracker.ietf.org/doc/html/rfc8725
 * - https://www.better-auth.com/docs/concepts/session-management
 * - https://www.better-auth.com/docs/plugins/bearer
 * - https://www.better-auth.com/docs/concepts/database
 * Tests:
 * - packages/auth/test/auth.test.mjs
 * - apps/api/test/api-app.test.mjs
 */

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

function toHeaders(headers: Headers | Record<string, string>): Headers {
  return headers instanceof Headers ? headers : new Headers(headers);
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
