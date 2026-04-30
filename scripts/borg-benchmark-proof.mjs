/**
 * Purpose: Runs the duplicate and near-duplicate source-plane workload through Borg in WSL so CDNgine can compare content-defined chunk dedupe against the current benchmark set.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/format-agnostic-upstream-review.md
 * External references:
 * - https://borgbackup.readthedocs.io/en/stable/usage/init.html
 * - https://borgbackup.readthedocs.io/en/stable/usage/create.html
 * - https://borgbackup.readthedocs.io/en/stable/usage/info.html
 * Tests:
 * - Manual validation with `npm run benchmark:source-plane-proof:borg`
 */

import { spawnSync } from 'node:child_process';

function runBorgProof() {
  const script = String.raw`
set -euo pipefail

root=$(mktemp -d /tmp/cdngine-borg-proof-XXXXXX)
cleanup() {
  rm -rf "$root"
}
trap cleanup EXIT

repo="$root/repo"
sources="$root/sources"
restore="$root/restore"
mkdir -p "$sources/base" "$sources/duplicate" "$sources/patch" "$restore"
export BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK=yes

python3 - "$sources" "$root/meta.json" <<'PY'
import hashlib
import json
import pathlib
import sys

sources = pathlib.Path(sys.argv[1])
meta_path = pathlib.Path(sys.argv[2])

def make_block(seed: int, size: int) -> bytes:
    state = ((seed + 1) * 2654435761) & 0xFFFFFFFF
    block = bytearray(size)
    for index in range(size):
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        block[index] = (state >> 16) & 0xFF
    return bytes(block)

block_size = 256 * 1024
blocks = [make_block(index + 1, block_size) for index in range(32)]
base = b"".join(blocks)
duplicate = bytes(base)
patch_blocks = list(blocks)
patch_blocks[10] = make_block(211, block_size)
patch_blocks[21] = make_block(223, block_size)
patch = b"".join(patch_blocks)

(sources / "base" / "checkpoint.bin").write_bytes(base)
(sources / "duplicate" / "checkpoint.bin").write_bytes(duplicate)
(sources / "patch" / "checkpoint.bin").write_bytes(patch)

meta_path.write_text(json.dumps({
    "logicalByteLength": len(base),
    "patchSha256": hashlib.sha256(patch).hexdigest()
}))
PY

borg init --encryption=none "$repo" >/dev/null 2>&1
after_init_bytes=$(du -sb "$repo" | cut -f1)

(
  cd "$root"
  borg create --compression none "$repo::base" sources/base >/dev/null 2>&1
)
after_base_bytes=$(du -sb "$repo" | cut -f1)

(
  cd "$root"
  borg create --compression none "$repo::duplicate" sources/duplicate >/dev/null 2>&1
)
after_duplicate_bytes=$(du -sb "$repo" | cut -f1)

(
  cd "$root"
  borg create --compression none "$repo::patch" sources/patch >/dev/null 2>&1
)
after_patch_bytes=$(du -sb "$repo" | cut -f1)

(
  cd "$restore"
  borg extract "$repo::patch" >/dev/null 2>&1
)
restored_sha=$(sha256sum "$restore/sources/patch/checkpoint.bin" | cut -d' ' -f1)

python3 - "$root/meta.json" "$after_init_bytes" "$after_base_bytes" "$after_duplicate_bytes" "$after_patch_bytes" "$restored_sha" <<'PY'
import json
import sys

meta = json.loads(open(sys.argv[1], "r", encoding="utf-8").read())
after_init = int(sys.argv[2])
after_base = int(sys.argv[3])
after_duplicate = int(sys.argv[4])
after_patch = int(sys.argv[5])
restored_sha = sys.argv[6]

logical = meta["logicalByteLength"]
base_delta = after_base - after_init
duplicate_delta = after_duplicate - after_base
patch_delta = after_patch - after_duplicate

print(json.dumps({
    "workload": "near-duplicate-binary-revisions",
    "repositoryEngine": "borg",
    "runtime": "wsl",
    "note": "Borg is measured through WSL with compression disabled so the stored-byte deltas primarily reflect chunk reuse plus Borg repository metadata.",
    "base": {
        "logicalByteLength": logical,
        "storedByteLength": base_delta,
        "archiveName": "base"
    },
    "duplicate": {
        "logicalByteLength": logical,
        "storedByteLength": duplicate_delta,
        "archiveName": "duplicate"
    },
    "patch": {
        "logicalByteLength": logical,
        "storedByteLength": patch_delta,
        "archiveName": "patch"
    },
    "improvement": {
        "duplicateSavingsRatio": 1 - duplicate_delta / logical,
        "patchSavingsRatio": 1 - patch_delta / logical
    },
    "restoreVerified": restored_sha == meta["patchSha256"]
}, indent=2))
PY
`;
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  const result = spawnSync('wsl', ['bash', '-lc', `echo ${encoded} | base64 -d | bash`], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Borg benchmark failed');
  }

  return result.stdout;
}

process.stdout.write(runBorgProof());
