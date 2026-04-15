# Archive And Package Ingestion

## Protected assets and boundaries

- archive and package upload pipeline
- inspection workers
- scratch storage and decompression limits

## Likely attacker actions

- zip bombs and decompression abuse
- malicious package contents
- path traversal or unsafe unpack behavior

## Preventative controls

- archive inventory inspection
- decompression-ratio and entry-count limits
- isolated scratch space
- malware scanning

## Detective controls

- malformed archive metrics
- quarantine rates for package classes

## Operator response expectations

- quarantine suspicious archives
- preserve enough evidence to explain why content was blocked
