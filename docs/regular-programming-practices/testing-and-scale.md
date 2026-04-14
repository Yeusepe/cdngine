# Testing And Scale

## 1. Delivery order

1. docs and contracts
2. failing expectation
3. narrower tests
4. implementation
5. resilience and replay evidence

## 2. Areas needing stronger evidence

- workflow durability
- idempotency
- retry and compensation behavior
- manifest correctness
- large-object ingest and derived fan-out
- namespace and file-type registration

## 3. Scale posture

Before declaring a high-risk path ready, verify:

- failure handling under retries
- queue and workflow backlog behavior
- operator replay usability
- cache and lock degradation behavior
- large-asset throughput assumptions

