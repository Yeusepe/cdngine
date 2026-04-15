-- Purpose: Creates the application database used by the local fast-start stack.
-- Governing docs:
-- - deploy/local-platform/README.md
-- - docs/environment-and-deployment.md
-- External references:
-- - https://hub.docker.com/_/postgres
-- Tests:
-- - docker compose --env-file deploy/local-platform/.env.example -f deploy/local-platform/compose.fast-start.yaml config

CREATE USER cdngine WITH PASSWORD 'cdngine';
CREATE DATABASE cdngine OWNER cdngine;
