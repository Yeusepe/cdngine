# ADR 0007: CDN As Code SDK And FFI Model

## Status

Accepted

## Context

CDNgine should not feel like "an HTTP API you manually assemble from docs."

The user goal is closer to what Convex did for databases:

- code-first developer experience
- strong generated typing
- one obvious path for common operations
- contracts that can be consumed from many languages

At the same time, the platform still needs interoperable standards and portable wire contracts.

Official standards and platform references point toward:

- OpenAPI 3.1 and JSON Schema for HTTP contracts
- RFC 9457 for typed API errors
- Arazzo for multi-step API workflow descriptions
- resource-oriented API design for predictable client generation
- stable FFI boundaries for languages where a shared native core is valuable

## Decision

Adopt a **CDN as code** SDK posture with three layers:

1. **contract layer**
   - public HTTP contract published as OpenAPI 3.1 plus JSON Schema
   - multi-step workflows such as upload, completion, and polling published as Arazzo workflow descriptions
2. **shared SDK core**
   - a small handwritten core owns hard cross-language logic such as upload orchestration, retries, manifest decoding, polling, and signing helpers
   - the shared core should be implemented in Rust when native FFI reuse is needed
3. **idiomatic language surfaces**
   - TypeScript gets a first-class generated developer surface
   - other languages get thin wrappers over generated transport and, where appropriate, the shared native core

## FFI posture

Use two interoperability layers:

1. **stable C ABI boundary**
   - Rust exports a small, explicit C ABI
   - C and C++ headers are generated with `cbindgen`
2. **higher-level generated bindings**
   - UniFFI is preferred for Kotlin, Swift, and Python bindings over the Rust core where the feature set is a good fit

Languages that do not need the native core can still use generated HTTP SDKs from the OpenAPI contract.

## Consequences

- the API must be designed for SDK generation, not only human reading
- public operations need stable names, examples, and error types
- upload should be easy in SDKs even if the raw wire protocol remains multi-step
- TypeScript should expose generated app-specific helpers in the style of checked-in generated code
- multi-language support should not require reimplementing signing, manifest parsing, and upload orchestration repeatedly
- the public HTTP surface remains the compatibility contract; FFI is an SDK implementation strategy, not a replacement for the API

## References

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
