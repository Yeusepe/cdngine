# Storage And State

This document defines state ownership.

| System | Owns |
| --- | --- |
| canonical source repository | canonical deduplicated asset content, reconstruction metadata, and source history |
| SQL registry | asset metadata, workflow state, manifests, registrations |
| Redis | cache, locks, and short-lived coordination only |
| S3-compatible derived store | processed delivery artifacts |

Rules:

- Redis is not the source of truth
- raw and derived assets stay separate
- state ownership must be obvious at design time
- SQL is the durable control-plane state
- every cross-store flow needs an idempotency story

## References

- [PostgreSQL documentation](https://www.postgresql.org/docs/)
- [Redis documentation](https://redis.io/docs/latest/)
- [Temporal documentation](https://docs.temporal.io/)
