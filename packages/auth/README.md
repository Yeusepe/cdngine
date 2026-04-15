# Auth Package

`@cdngine/auth` is the repository's Better Auth integration layer.

It owns:

- bearer-token session validation
- server-side mapping from Better Auth sessions into CDNgine actor scope
- an in-memory auth fixture for tests and the demo

Primary exports:

- `createCDNgineAuth(...)` for runtime integration with a Better Auth adapter
- `createInMemoryCDNgineAuth(...)` for tests and the demo scenario generator
- `buildBearerHeaders(...)` for callers that need a request header helper

Governing docs:

- `docs/security-model.md`
- `docs/service-architecture.md`
- `docs/package-reference.md`
- `docs/problem-types.md`
