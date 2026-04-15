# Deploy

This directory is for deployment artifacts, reference stack definitions, and environment-specific bring-up files.

The current documented topology matrix is:

1. single-node + single-bucket
2. single-node + multi-bucket
3. multi-node + single-bucket
4. multi-node + multi-bucket

The first concrete target is `local-platform/`, which is currently a **single-node + multi-bucket** fast-start profile backed by RustFS. It can also be collapsed into **single-node + single-bucket** by reusing one bucket name with distinct prefixes.

The future production artifacts in this directory should preserve the same logical roles across all four topologies instead of redefining the platform for each packaging choice.
