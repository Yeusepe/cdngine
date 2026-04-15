# Private Delivery

## Protected assets and boundaries

- private derivative reads
- manifest and segment bundle delivery
- signed URL and signed-cookie issuance

## Likely attacker actions

- enumerate private asset existence
- reuse expired or stolen delivery credentials
- escalate from one delivery scope to another

## Preventative controls

- non-disclosing public-read posture
- short-lived signed credentials
- path and delivery-scope binding
- separate control-plane auth from CDN origin access

## Detective controls

- signed credential failure metrics
- unauthorized read rates by delivery scope

## Operator response expectations

- rotate or invalidate signing material when abuse is suspected
- confirm whether the issue is public-delivery probing or authenticated misuse
