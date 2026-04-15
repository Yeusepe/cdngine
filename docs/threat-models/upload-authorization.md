# Upload Authorization

## Protected assets and boundaries

- upload-session issuance
- scope-bound upload targets
- completion callbacks
- staged objects before canonicalization

## Likely attacker actions

- create uploads in an unauthorized namespace or tenant scope
- replay old completion callbacks
- smuggle mismatched metadata or content type

## Preventative controls

- authenticated upload-session creation
- scope-bound upload session and completion authorization
- signed or authenticated completion callbacks
- checksum and file-signature verification

## Detective controls

- audit events for upload-session issuance and completion
- alerts on repeated scope-denial or completion-failure spikes

## Operator response expectations

- determine whether abuse is caller-specific or platform-wide
- quarantine suspicious versions where evidence is unclear
