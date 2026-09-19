#!/usr/bin/env bash
# Materialises a patched copy of upstream liprep for the harness to import from.
#
# Source of truth: the liprep clone at artifacts/sat-practice/liprep (repo root),
# pinned to commit c84d3dc099653cc82fa2d380a7bbd299ae52201e. This script never
# touches that clone — it copies liprep's src/ into harness/.upstream/ (gitignored)
# and applies tests/domain/sat/upstream/upstream.patch there.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="$(cd "$HARNESS_DIR/.." && pwd)"  # tests/domain/sat/upstream
REPO_ROOT="$(cd "$HARNESS_DIR/../../../../.." && pwd)"
LIPREP_CLONE="$REPO_ROOT/artifacts/sat-practice/liprep"
PATCH_FILE="$UPSTREAM_DIR/upstream.patch"
DEST="$HARNESS_DIR/.upstream"

EXPECTED_COMMIT="c84d3dc099653cc82fa2d380a7bbd299ae52201e"

if [ ! -d "$LIPREP_CLONE/.git" ]; then
  echo "error: liprep clone not found at $LIPREP_CLONE" >&2
  exit 1
fi

ACTUAL_COMMIT="$(git -C "$LIPREP_CLONE" rev-parse HEAD)"
if [ "$ACTUAL_COMMIT" != "$EXPECTED_COMMIT" ]; then
  echo "error: liprep clone is at $ACTUAL_COMMIT, expected $EXPECTED_COMMIT" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a --exclude='.git' "$LIPREP_CLONE"/ "$DEST"/

(cd "$DEST" && patch -p1 < "$PATCH_FILE")

PATCH_SHA256="$(sha256sum "$PATCH_FILE" | cut -d' ' -f1)"

cat > "$HARNESS_DIR/.upstream-stamp.json" <<JSON
{
  "upstream_commit": "$ACTUAL_COMMIT",
  "patch_sha256": "$PATCH_SHA256",
  "prepared_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "Prepared $DEST from liprep@$ACTUAL_COMMIT with patch sha256=$PATCH_SHA256"
