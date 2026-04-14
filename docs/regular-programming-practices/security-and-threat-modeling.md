# Security And Threat Modeling

## 1. Default posture

- fail closed on authorization-sensitive paths
- validate signatures, MIME, and declared content
- keep secrets server-side
- keep operator actions auditable

## 2. Threat-model triggers

Threat-model changes that affect:

- upload authorization
- private delivery
- workflow replay
- archive and package ingestion
- signed URLs and service-to-service trust

