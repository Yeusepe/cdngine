/**
 * Purpose: Runs the rigorous multi-workload source-plane benchmark suite through Borg in WSL so CDNgine can compare snapshot-repository size, speed, and restore behavior across repeated runs.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/testing-strategy.md
 * - docs/format-agnostic-upstream-review.md
 * External references:
 * - https://borgbackup.readthedocs.io/en/stable/usage/init.html
 * - https://borgbackup.readthedocs.io/en/stable/usage/create.html
 * - https://borgbackup.readthedocs.io/en/stable/usage/info.html
 * Tests:
 * - scripts/source-plane-benchmark-framework.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listBenchmarkWorkloads, summarizeWorkloadRuns } from './source-plane-benchmark-framework.mjs';

function getRepetitions() {
  const value = Number(process.env.CDNGINE_SOURCE_BENCHMARK_REPETITIONS ?? '3');

  return Number.isInteger(value) && value > 0 ? value : 3;
}

function toWslPath(windowsPath) {
  const normalized = windowsPath.replace(/\\/g, '/');
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`.replace(/^\/([a-z])\//, '/mnt/$1/');
}

function runWorkload(workload) {
  const temporarySpecRoot = mkdtempSync(join(tmpdir(), 'cdngine-borg-spec-'));
  const specFile = join(temporarySpecRoot, 'workload.json');
  writeFileSync(specFile, JSON.stringify(workload));
  const script = `
set -euo pipefail
root=$(mktemp -d /tmp/cdngine-borg-suite-XXXXXX)
cleanup() {
  rm -rf "$root"
}
trap cleanup EXIT
repo="$root/repo"
restore="$root/restore"
mkdir -p "$restore"
export BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK=yes
python3 - "$root" "${toWslPath(specFile)}" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
workload = json.loads(pathlib.Path(sys.argv[2]).read_text())

def make_block(seed: int, size: int) -> bytes:
    state = ((seed + 1) * 2654435761) & 0xFFFFFFFF
    out = bytearray(size)
    for i in range(size):
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        out[i] = (state >> 16) & 0xFF
    return bytes(out)

for stage_name, files in workload["versions"].items():
    stage_root = root / stage_name
    stage_root.mkdir(parents=True, exist_ok=True)
    for file in files:
        path = stage_root / pathlib.Path(file["relativePath"].replace("\\\\", "/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"".join(make_block(segment["seed"], segment["size"]) for segment in file["segments"]))
PY
du_bytes() {
  du -sb "$1" | cut -f1
}
count_files() {
  find "$1" -type f | wc -l | tr -d ' '
}
count_bytes() {
  find "$1" -type f -printf '%s\n' | awk '{total += $1} END {print total + 0}'
}
hash_tree() {
  (
    cd "$1"
    find . -type f -print0 | sort -z | xargs -0 sha256sum
  )
}
borg init --encryption=none "$repo" >/dev/null 2>&1
after_init_bytes=$(du_bytes "$repo")
base_started=$(python3 - <<'PY'
import time
print(time.time())
PY
)
( cd "$root" && borg create --compression none "$repo::base" base >/dev/null 2>&1 )
base_ended=$(python3 - <<'PY'
import time
print(time.time())
PY
)
after_base_bytes=$(du_bytes "$repo")
duplicate_started=$(python3 - <<'PY'
import time
print(time.time())
PY
)
( cd "$root" && borg create --compression none "$repo::duplicate" duplicate >/dev/null 2>&1 )
duplicate_ended=$(python3 - <<'PY'
import time
print(time.time())
PY
)
after_duplicate_bytes=$(du_bytes "$repo")
patch_started=$(python3 - <<'PY'
import time
print(time.time())
PY
)
( cd "$root" && borg create --compression none "$repo::patch" patch >/dev/null 2>&1 )
patch_ended=$(python3 - <<'PY'
import time
print(time.time())
PY
)
after_patch_bytes=$(du_bytes "$repo")
restore_started=$(python3 - <<'PY'
import time
print(time.time())
PY
)
( cd "$restore" && borg extract "$repo::patch" >/dev/null 2>&1 )
restore_ended=$(python3 - <<'PY'
import time
print(time.time())
PY
)
python3 - "$root" "$after_init_bytes" "$after_base_bytes" "$after_duplicate_bytes" "$after_patch_bytes" "$base_started" "$base_ended" "$duplicate_started" "$duplicate_ended" "$patch_started" "$patch_ended" "$restore_started" "$restore_ended" <<'PY'
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
after_init = int(sys.argv[2])
after_base = int(sys.argv[3])
after_duplicate = int(sys.argv[4])
after_patch = int(sys.argv[5])
base_started = float(sys.argv[6])
base_ended = float(sys.argv[7])
duplicate_started = float(sys.argv[8])
duplicate_ended = float(sys.argv[9])
patch_started = float(sys.argv[10])
patch_ended = float(sys.argv[11])
restore_started = float(sys.argv[12])
restore_ended = float(sys.argv[13])

def stage_stats(stage_name, stored_delta, started, ended):
    stage_root = root / stage_name
    file_count = sum(1 for path in stage_root.rglob("*") if path.is_file())
    logical = sum(path.stat().st_size for path in stage_root.rglob("*") if path.is_file())
    return {
        "fileCount": file_count,
        "logicalByteLength": logical,
        "storedByteLength": stored_delta,
        "durationMs": (ended - started) * 1000.0
    }

def hash_tree(path):
    rows = subprocess.check_output(
        "find . -type f -print0 | sort -z | xargs -0 sha256sum",
        shell=True,
        cwd=path,
        text=True
    ).strip().splitlines()
    return rows

patch_hashes = hash_tree(root / "patch")
restore_hashes = hash_tree(root / "restore" / "patch")

print(json.dumps({
    "base": stage_stats("base", after_base - after_init, base_started, base_ended),
    "duplicate": stage_stats("duplicate", after_duplicate - after_base, duplicate_started, duplicate_ended),
    "patch": stage_stats("patch", after_patch - after_duplicate, patch_started, patch_ended),
    "restore": {
        "fileCount": sum(1 for path in (root / "patch").rglob("*") if path.is_file()),
        "logicalByteLength": sum(path.stat().st_size for path in (root / "patch").rglob("*") if path.is_file()),
        "durationMs": (restore_ended - restore_started) * 1000.0,
        "verified": patch_hashes == restore_hashes
    }
}, indent=2))
PY
`;
  try {
    const encoded = Buffer.from(script, 'utf8').toString('base64');
    const result = spawnSync('wsl', ['bash', '-lc', `echo ${encoded} | base64 -d | bash`], {
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      throw new Error(
        [
          `Borg workload failed: ${workload.id}`,
          result.stdout?.trim(),
          result.stderr?.trim()
        ]
          .filter(Boolean)
          .join('\n\n')
      );
    }

    return JSON.parse(result.stdout);
  } finally {
    rmSync(temporarySpecRoot, { recursive: true, force: true });
  }
}

const repetitions = getRepetitions();
const workloads = listBenchmarkWorkloads();

process.stdout.write(
  JSON.stringify(
    {
      engine: 'borg',
      category: 'snapshot repository',
      metricMode:
        'repository growth on disk through WSL, which is reproducible but can overstate per-archive patch storage because Borg appends segment and index data beyond the archive-unique chunk payload.',
      repetitions,
      workloads: workloads.map((workload) => {
        const runs = Array.from({ length: repetitions }, () => runWorkload(workload));

        return {
          id: workload.id,
          title: workload.title,
          description: workload.description,
          runs,
          summary: summarizeWorkloadRuns(runs)
        };
      })
    },
    null,
    2
  )
);
