# System Inputs And Outputs

This document maps the platform's main sync and async boundaries.

The point is not only to list inputs and outputs, but to make the ownership and data shape of each boundary explicit.

## 1. External ingress

| Input source | Entry point | Primary outputs |
| --- | --- | --- |
| API client | public asset and metadata APIs | upload session, status, manifests, signed delivery references |
| platform owner | platform-admin APIs | namespace and capability governance actions |
| internal service | private service-authenticated APIs | platform-owned asset operations and orchestration commands |
| operator | operator APIs and admin surfaces | replay, purge, quarantine, diagnostics |
| upload completion source | completion callback or event | canonicalization and workflow dispatch intent |

## 2. Core output families

The platform emits:

- raw asset repository, commit, and canonical path references in Oxen
- ingest-object references before canonicalization
- derivative objects in the derived store
- manifests for complex asset classes
- workflow and audit state in the registry
- signed delivery URLs or delivery paths

## 3. Async flows

| Producer | Event or command | Consumer |
| --- | --- | --- |
| ingest service | upload completed | workflow gateway / Temporal starter |
| Temporal | job scheduled | processor worker |
| processor worker | derivative completed | registry updater |
| registry | manifest published | consumers and notification hooks |
| operator service | replay requested | workflow gateway / Temporal |

## 4. Boundary rules

1. every API group has a named owner
2. every event is replay-safe and versioned
3. every boundary validates input at first receipt
4. every output is understandable without reading implementation internals
5. public and private service boundaries stay distinct

## 5. Questions this document should help answer

It should be easy to tell:

- which inputs are public versus private
- where canonical source data enters the system
- where delivery data leaves the system
- which boundaries are synchronous and which are workflow-owned
- where operators intervene in the lifecycle

## 6. Read more

- [Architecture](./architecture.md)
- [Service Architecture](./service-architecture.md)
- [API Surface](./api-surface.md)
