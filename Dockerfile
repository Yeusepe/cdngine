# syntax=docker/dockerfile:1.7
# Purpose: Builds the portable CDNgine demo/runtime container used by the local Docker instance.
# Governing docs:
# - README.md
# - deploy/local-platform/README.md
# - docs/environment-and-deployment.md
# - docs/repository-layout.md
# External references:
# - https://docs.docker.com/reference/dockerfile/
# - https://hub.docker.com/_/node
# - https://manpages.debian.org/bookworm/apt/apt.conf.5.en.html
# - https://vite.dev/guide/cli.html
# Tests:
# - scripts/docker-instance.test.mjs

FROM node:24-bookworm-slim

WORKDIR /workspace

RUN apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true update \
  && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development
ENV HOST=0.0.0.0

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY contracts ./contracts
COPY scripts ./scripts
COPY deploy ./deploy

RUN npm ci

EXPOSE 4000 5173

CMD ["npm", "run", "runtime:start", "--workspace", "@cdngine/demo"]
