# SDK Strategy

This document defines the intended SDK posture.

## 1. Goals

SDKs should be:

- portable
- strongly typed
- easy to browse in editors
- generated or schema-assisted wherever possible

## 2. Recommended direction

- use schema-driven generation from HTTP and event contracts
- keep rich descriptions, examples, deprecations, and error metadata in the source schemas
- generate editor-friendly types and docs
- provide a narrow shared core for signing, upload flow, manifest parsing, retries, and cache helpers

## 2.1 Shared core responsibilities

The shared SDK core should own:

- request signing
- upload-session handling
- multipart upload helpers
- manifest parsing
- retry and backoff policy
- typed problem-detail decoding
- local cache helpers where appropriate

Language wrappers should stay thin and avoid re-implementing platform rules.

## 3. Editor ergonomics

SDK outputs should surface:

- autocomplete
- inline field descriptions
- typed errors
- `@deprecated` and `@see` metadata
- example-friendly entry points

## 4. Generation strategy

Prefer:

1. schema-driven generation for transport and models
2. a small handwritten shared core for hard logic
3. thin, idiomatic wrappers per language

This keeps the developer surface ergonomic without forcing many independent reimplementations of signing, manifests, and retries.

## 4.1 Recommended tooling posture

The platform should prefer:

- OpenAPI-driven transport and model generation
- AsyncAPI-driven event model generation where practical
- TypeDoc or equivalent generated reference for exported TypeScript APIs

OpenAPI Generator is a strong default because it supports many client generators and customization hooks, which is useful when the platform needs both broad language reach and a consistent contract source.

## 5. Language targets

The architecture should optimize for a shared core plus thin wrappers for:

- TypeScript and Node.js
- Python
- C#
- Swift
- Kotlin
- C and C++

Generated models should stay consistent across languages even if the transport helpers differ.

## 5.1 Wrapper rules

Language wrappers should:

- stay thin
- feel idiomatic in their host language
- avoid forking platform semantics
- defer hard cross-language logic to the shared core or schema source

## 6. Documentation strategy

SDK releases should ship with:

- generated API reference
- hand-written quickstarts
- minimal end-to-end upload examples
- manifest consumption examples
- migration notes for breaking or deprecated changes

Generated docs should be complemented by human-written guidance for:

- upload session flow
- async processing lifecycle
- manifest interpretation
- common failure handling
- namespace registration and configuration

## 7. Editor metadata

To keep SDKs pleasant in editors, source schemas should carry:

- descriptions
- examples
- enum semantics
- deprecation markers
- related-resource references

That metadata should flow into generated wrappers wherever the generator supports it.

TypeDoc is a good default for TypeScript API reference because it documents exports directly from source and can generate HTML or JSON models for downstream tooling.

## 8. References

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [JSON Schema](https://json-schema.org/)
- [AsyncAPI](https://www.asyncapi.com/docs)
- [TypeDoc](https://typedoc.org/)
- [Fern](https://buildwithfern.com/docs)
- [OpenAPI Generator](https://openapi-generator.tech/)
- [Speakeasy docs](https://www.speakeasy.com/docs)

