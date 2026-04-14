# Engineering Guide

This document defines engineering expectations for CDNgine.

## 1. Core rules

1. Work TDD-first and expectation-first.
2. Prefer package and platform capabilities over custom implementation.
3. Keep concerns isolated.
4. Keep changes reviewable.
5. Update docs, contracts, and tests together.
6. Optimize for durable, observable behavior rather than clever shortcuts.
7. Keep extension points explicit and boring.

## 2. Key expectations

- architecture decisions do not live only in chat
- service boundaries stay explicit
- extensibility does not excuse unclear ownership
- performance and durability are part of normal delivery, not later cleanup

## 3. Implementation posture

Default order of preference:

1. existing platform capability
2. declarative registration
3. upstream package or managed service
4. narrow custom code

Any change that skips ahead in that order should explain why.

## 4. Documentation posture

- docs are part of the product surface
- exported contracts should carry examples and descriptions
- traceability and implementation ledger updates land with the same slice

## 5. References

- [Google Engineering Practices](https://google.github.io/eng-practices/)
- [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

