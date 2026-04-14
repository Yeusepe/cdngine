# Workload And Recipe Matrix

This document maps representative product workloads to platform capabilities and recipe families.

The point is to show how the generic platform supports real product patterns without hard-coding product-specific business rules into the architecture.

## 1. Representative workload matrix

| Workload | Inputs | Typical outputs | Notes |
| --- | --- | --- | --- |
| backwall media | image or video | video derivative, poster, manifest | image inputs may also bind to image-to-video recipes |
| booth texture | texture image | WebP master, slices or tiles, manifest | tile precomputation may be used for hot slice patterns |
| art gallery | image | WebP master, thumbnail set | mostly image-optimized delivery |
| event banners | image | validated banner variant, WebP output | policy-heavy dimension validation |
| event presentation | PDF, PPT, PPTX | per-slide images, slide manifest | requires normalization plus rasterization |
| video uploads | video | HLS ladder, MP4 fallback, poster | long-running orchestration and publication |
| Unity packages | `.unitypackage`, bundles | raw binary, inventory manifest, scan results | preserve original even when no transform is bound |
| Substance assets | `.sbs`, `.sbsar` | raw binary, metadata, optional generated textures | future custom processors likely |
| generic archives | `.zip` and other archives | raw binary, inventory manifest, optional extraction results | strong security posture required |

## 2. Recipe families

Common recipe families:

- `preserve-original`
- `webp-master`
- `thumbnail-small`
- `thumbnail-medium`
- `region-slice`
- `tile-set`
- `poster-frame`
- `preview-clip`
- `hls-ladder`
- `mp4-fallback`
- `normalized-pdf`
- `slide-images`
- `inventory-manifest`

## 3. Binding notes

- image uploads often bind to `webp-master`, `thumbnail-small`, and `thumbnail-medium`
- backwall image uploads may additionally bind to `image-to-video-loop`
- presentation uploads bind to `normalized-pdf`, `slide-images`, and a manifest recipe
- archive and package uploads may bind only to `preserve-original` and `inventory-manifest` until a domain-specific processor is registered

## 4. Why this matrix matters

This matrix is useful because it shows:

- where one asset class fans out into several delivery outputs
- where long-running orchestration is unavoidable
- where preserve-only behavior is valid
- where security and inspection are first-class requirements rather than optional extras

## 5. Read more

- [Pipeline Capability Model](./pipeline-capability-model.md)
- [Workflow Extensibility](./workflow-extensibility.md)
- [Architecture](./architecture.md)
