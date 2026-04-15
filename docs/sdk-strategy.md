# SDK Strategy

This document defines the intended SDK posture for CDNgine.

The bar is not merely "generated clients exist." The bar is that CDNgine should feel like **CDN as code**:

- typed
- discoverable
- hard to misuse
- easy to adopt from multiple languages

## 1. Goals

SDKs should be:

- easy enough that common asset flows do not require reading the raw HTTP docs first
- strongly typed and editor-friendly
- generated from durable contracts wherever possible
- portable across languages without re-implementing core platform behavior repeatedly
- explicit about async behavior, polling, manifests, and typed failures

## 2. Standards posture

The SDK model should be grounded in these published contract standards:

- **OpenAPI 3.1** for public HTTP resources
- **JSON Schema** for schema portability
- **RFC 9457** for typed error envelopes
- **Arazzo** for multi-step workflow descriptions such as upload, completion, and polling

The platform should also follow resource-oriented API design so generated method names and SDK grouping stay predictable.

## 3. CDN as code model

The desired experience is closer to generated application APIs than to raw REST wrappers.

That means the platform should eventually support:

1. checked-in generated client code for TypeScript projects
2. app-local typed configuration or registration code for namespaces, recipes, and manifests where the adopter owns those concepts
3. first-class SDK helpers such as:
   - `client.assets.upload(...)`
   - `client.assets.waitForVersion(...)`
   - `client.manifests.get(...)`
   - `client.derivatives.url(...)`
   - `client.deliveries.authorize(...)`
4. generated types that reflect the app's configured namespace, manifest, and derivative shapes where possible

The public HTTP API remains the compatibility contract, but it should not be the only developer-facing shape.

## 4. Layered SDK architecture

The SDK system should have three layers.

### 4.1 Contract layer

This is the source of truth for public integration:

- OpenAPI 3.1
- JSON Schema
- machine-readable examples
- Arazzo workflow descriptions

This layer defines transport contracts, resource models, and multi-step workflows in a language-neutral way.

### 4.2 Shared core layer

Some logic is annoying, easy to get wrong, and repeated across languages if left in wrappers.

The shared core should own:

- upload orchestration
- resumable-upload helper behavior
- polling and wait helpers
- manifest parsing and validation helpers
- request signing or delivery-signature helpers where the SDK is responsible
- signed-cookie bundle helpers where the SDK participates in delivery authorization
- retry and backoff behavior
- typed problem-detail decoding

This layer should stay intentionally small.

### 4.3 Idiomatic wrapper layer

Each language should expose a host-idiomatic surface over the contract layer and, where relevant, the shared core.

Wrappers should:

- keep names idiomatic
- preserve platform semantics
- avoid inventing language-specific behavior drift
- keep the "one obvious way" for common flows

## 5. FFI strategy

Where a reusable native core is beneficial, the preferred implementation is:

- **Rust** for the shared SDK core
- **C ABI** as the lowest-level stable boundary
- **UniFFI** for higher-level bindings where supported

### 5.1 Why Rust for the shared core

Rust is a good fit for:

- deterministic binary-safe logic
- parsing and manifest helpers
- upload and retry state machines
- emitting stable native artifacts for multiple host languages

This does not require the service implementation to move away from TypeScript.

### 5.2 C ABI baseline

The lowest-level FFI contract should be a narrow C ABI.

That gives CDNgine:

- a portable baseline for C and C++
- a conservative interop surface
- a stable contract even when higher-level generators vary

Headers should be generated rather than handwritten when possible.

### 5.3 UniFFI posture

UniFFI is the preferred higher-level bridge when the Rust core should be exposed to:

- Swift
- Kotlin
- Python

Use it where it reduces wrapper effort without distorting the SDK shape.

### 5.4 Generated HTTP SDKs still matter

FFI is not the whole strategy.

Generated HTTP SDKs remain important for:

- languages that do not need the native core
- environments where native packaging is undesirable
- broad contract portability from the OpenAPI spec

## 6. Language targets

The target posture is:

- **TypeScript**: first-class, generated, code-first surface
- **Python**: thin wrapper over generated transport and, where useful, UniFFI-backed helpers
- **Swift**: idiomatic mobile surface, potentially backed by UniFFI for complex client logic
- **Kotlin**: idiomatic Android/JVM surface, potentially backed by UniFFI for complex client logic
- **C#**: generated transport plus handwritten ergonomic layer as needed
- **C/C++**: C ABI and generated headers for native integrations

Other languages can start with generated HTTP clients and add native bindings only when the value is clear.

## 7. Public SDK ergonomics rules

Public SDKs should:

1. expose high-level operations before low-level transport details
2. make async lifecycle obvious
3. make typed errors first-class
4. give manifest and derivative helpers names that match the resource model
5. avoid forcing callers to manually assemble signed URLs, polling loops, or multipart upload semantics
6. avoid forcing callers to individually sign or stitch stream segments
7. preserve ownership and scope concepts explicitly

## 8. API design rules for SDK generation

The API must be easy to generate from.

Required posture:

- stable resource-oriented paths
- stable `operationId` values
- clear tags and grouping
- field descriptions and examples on public schemas
- explicit async states
- explicit ownership and scope fields
- explicit delivery-scope and authorization-mode fields
- RFC 9457 problem types for public errors
- Arazzo workflows for multi-step operations

If an API change harms generated method names or common-flow ergonomics, that is an SDK design issue, not just a docs issue.

## 9. TypeScript-first generated experience

TypeScript should get the strongest experience because it is the leading implementation language for the service stack and the most natural place for a Convex-like developer surface.

The preferred posture is:

- checked-in generated client artifacts
- editor-visible docs on generated methods and models
- application-specific generated types where local registrations affect the client surface
- examples that look like normal application code, not protocol assembly

## 10. Documentation strategy

SDK releases should ship with:

- generated API reference
- quickstarts per language
- upload examples
- polling and manifest examples
- migration notes
- examples of typed error handling

The workflow docs should not exist only as prose. Multi-step examples should stay aligned to Arazzo and the generated SDK entry points.

## 11. References

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [JSON Schema](https://json-schema.org/)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html)
- [Google AIP-121: Resource-oriented design](https://google.aip.dev/121)
- [Google AIP-130: Standard methods](https://google.aip.dev/130)
- [UniFFI user guide](https://mozilla.github.io/uniffi-rs/latest/)
- [cbindgen](https://github.com/mozilla/cbindgen)
- [Convex generated code](https://docs.convex.dev/generated-api/)
- [Convex OpenAPI and other languages](https://docs.convex.dev/client/open-api)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- [RFC 8216: HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216.html)
