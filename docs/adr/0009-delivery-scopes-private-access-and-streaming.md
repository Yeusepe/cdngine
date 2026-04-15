# ADR 0009: Delivery Scopes, Private Access, And Streaming

## Status

Accepted

## Context

CDNgine needs explicit answers to four delivery questions that are often left vague until systems become painful to operate:

1. what happens when the same file becomes hot and is requested repeatedly
2. what response posture should the public delivery path use for assets a caller is not allowed to read
3. how should organizations get separate delivery URLs or hostnames
4. how should video streaming be authorized and published

These are not edge cases for CDNgine. They are core platform concerns because the workload includes Unity packages, Substance files, FBX assets, textures, video masters, and published streaming outputs.

## Decision

Adopt the following delivery model:

1. versioned derivatives and video segments use immutable URLs and immutable cache semantics
2. hot delivery should use CDN tiering and reserve-style persistence where the chosen CDN supports it
3. private public-path reads are non-disclosing by default and should normally return `404` when the caller lacks valid delivery authorization
4. explicit control-plane reads may still return `403` when the caller is authenticated and the denial is useful
5. delivery identity is modeled through a first-class `DeliveryScope` that can represent:
   - shared-domain plus path prefix
   - organization subdomain
   - organization custom hostname
6. authorization must not trust the `Host` header alone; hostnames resolve to a registered delivery scope and normal policy still applies
7. video streaming is published as HLS-style manifests and immutable segments
8. private stream authorization should prefer bundle-level credentials such as signed cookies over per-segment URL signing

## Alternatives considered

### Treat delivery URLs as incidental strings built in code

Rejected because organization-specific URLs, certificates, caches, and auth rules need explicit modeling.

### Return `403` for every denied delivery request

Rejected because public delivery would become an existence oracle for private assets.

### Sign every HLS segment URL independently

Rejected as the default because it creates unnecessary client and CDN complexity for bundle reads.

### Route every hot read directly to origin and rely on object-store scale

Rejected because it wastes origin capacity and makes hot-asset cost and latency harder to control.

## Consequences

- the domain model must include a `DeliveryScope`
- manifests and derivatives must carry delivery-scope linkage
- the API and SDK surface must support delivery authorization as a first-class concept
- observability must separate manifest hits, segment hits, signed-cookie failures, and origin misses
- service registration must define default delivery-scope behavior for each namespace

## References

- [Cloudflare Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Cloudflare Cache Reserve API model](https://developers.cloudflare.com/api/node/resources/cache/subresources/cache_reserve/models/cache_reserve/)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- [Amazon CloudFront range GETs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html)
- [RFC 8246: HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246.html)
- [RFC 8216: HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
