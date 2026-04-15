# Document Conversion

## Protected assets and boundaries

- untrusted Office and PDF inputs
- conversion workers and document toolchains
- generated normalized outputs

## Likely attacker actions

- exploit document converters through crafted inputs
- consume excessive memory, disk, or CPU
- exfiltrate through overly permissive worker egress

## Preventative controls

- isolated conversion workers
- bounded CPU, memory, disk, and time
- no broad egress by default
- quarantine on suspicious conversion behavior

## Detective controls

- conversion crash and timeout clustering
- quarantine and validation-failure trends

## Operator response expectations

- isolate the affected worker class
- stop replaying the same malicious input pattern until root cause is understood
