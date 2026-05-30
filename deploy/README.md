# Deploy

This directory is for deployment artifacts, reference stack definitions, and environment-specific bring-up files.

The current documented topology matrix is:

1. single-node + single-bucket
2. single-node + multi-bucket
3. multi-node + single-bucket
4. multi-node + multi-bucket

The first concrete target is `local-platform/`, which is currently a **single-node + multi-bucket** fast-start profile backed by RustFS. It can also be collapsed into **single-node + single-bucket** by reusing one bucket name with distinct prefixes.

`local-platform/compose.instance.yaml` layers the Dockerized CDNgine runtime container and optional demo profile onto that same dependency profile. Use `npm run docker:start` from the repository root for the easiest local runtime instance, or `npm run docker:start:demo` when the UI demo is wanted.

`remote/compose.latest.yaml` is the no-checkout path for adopters who want the latest GitHub version directly:

```bash
docker compose -f https://github.com/Yeusepe/cdngine.git#main:deploy/remote/compose.latest.yaml up -d --build cdngine-runtime
```

That command reads the Compose file from the repository and builds the runtime image from the same Git branch.

The future production artifacts in this directory should preserve the same logical roles across all four topologies instead of redefining the platform for each packaging choice.
