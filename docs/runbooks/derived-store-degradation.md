# Derived Store Degradation

## Detection

- derived-store write failures
- manifest publication failures caused by missing artifact writes
- CDN origin errors on newly published artifacts

## Scope and blast radius

1. confirm whether reads, writes, or both are degraded
2. identify affected delivery scopes
3. determine whether publication should pause globally or only for one artifact class

## Inspect

- derived-store error metrics
- publication failure logs
- CDN origin miss and error dashboards

## Safe actions

- pause new publication if writes are failing persistently
- preserve workflow state for later replay rather than forcing partial publication
- continue serving already-cached immutable artifacts where safe

## Never do

- mark a version as published when manifest or derivative writes are missing
- delete canonical source data to reduce pressure

## Confirm recovery

- writes succeed consistently
- blocked publication backlog drains
- manifests no longer reference missing objects
