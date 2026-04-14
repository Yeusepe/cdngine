# Pipeline Capability Model

This document defines the contract for file-type and processor registration.

## 1. Capability record

Each capability registration should declare:

- supported MIME types and extensions
- validation hooks
- recipe outputs
- execution resource profile
- retry and timeout policy
- deterministic key template
- schema version

## 2. Why this exists

The platform should not require core-service rewrites every time a new format appears.

The capability model is the answer to:

- how a namespace says "I support this file type"
- how the platform knows which validators and processors can run
- how workflows expand from a file type into recipe jobs
- how operators reason about what a processor is allowed to do

## 3. Design rule

A new file type should be addable by registration and processor implementation, not by editing shared branching logic across the platform.

## 4. Capability shape

Illustrative TypeScript shape:

```ts
export const backwallImageCapability = registerCapability({
  capabilityId: 'image.backwall',
  schemaVersion: 'v1',
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  extensions: ['.png', '.jpg', '.jpeg', '.webp'],
  validators: ['sniff-image', 'validate-backwall-dimensions'],
  recipes: ['webp-master', 'image-to-video-loop', 'poster-frame'],
  resourceProfile: 'image-medium',
  retryPolicy: 'default-media-retry',
  keyTemplate: '/{namespace}/{assetId}/{versionId}/{recipeId}/{schemaVersion}/{filename}',
});
```

## 5. Processor contract

A processor registration should declare:

- processor ID
- supported capability IDs
- supported recipe IDs
- required runtime profile
- expected inputs
- declared outputs
- timeout policy
- retry policy
- observability labels

Illustrative shape:

```ts
export const ffmpegImageToVideoProcessor = registerProcessor({
  processorId: 'ffmpeg-image-to-video',
  capabilities: ['image.backwall'],
  recipes: ['image-to-video-loop'],
  runtimeProfile: 'gpu-preferred',
  timeoutPolicy: 'video-short-transform',
  retryPolicy: 'media-retry-v1',
});
```

## 6. Registry rules

1. Capability IDs are stable and versioned deliberately.
2. Schema version changes are explicit and reviewable.
3. Validators and processors are referenced by registration ID, not hidden imports.
4. Capabilities should be testable in isolation from specific products.
5. Namespace policy may narrow a capability, but should not silently redefine it.

## 7. Metadata posture

The registry should allow structured capability metadata in SQL using PostgreSQL JSONB by default.

That metadata should remain:

- queryable
- versioned
- indexable where hot paths need it
- portable enough to map onto another SQL engine if an adopter brings one

PostgreSQL JSONB plus GIN indexing is the default posture for flexible metadata lookup, especially for capability flags, recipe bindings, and namespace-scoped policy fragments.

## 8. References

- [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- [PostgreSQL GIN indexes](https://www.postgresql.org/docs/current/gin.html)
- [Temporal documentation](https://docs.temporal.io/)

