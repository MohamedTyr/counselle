#!/usr/bin/env python3
"""Recompile ``config/cds/`` and assert the content hash matches the published manifest.

The pin below (``EXPECTED_CONTENT_SHA256`` / ``EXPECTED_VERSION``) tracks the
**published** ``cds_library.cds_manifests`` row, not just whatever is on disk.
The two must always move together: editing ``config/cds/manifest.yaml``'s
``version`` (or any domain content) changes the compiled hash, and that new
hash is only legitimate once a matching row has actually been published via
``scripts/publish_cds_manifest.py --publish`` (ship plan §1.5). Repinning this
constant to match an unpublished compile — "silently adjusting the expected
constant" — is exactly the mistake that let ``config/cds/`` and the live DB's
``5.0.2`` row diverge (ship plan §0.2/§0.6): the pin stopped tracking the
published manifest and nothing caught it before packets started failing at
commit. If this script ever fails, the fix is either (a) revert the local
edit so it compiles back to the published hash, or (b) publish a new version
and update this pin from that same post-publish compile — never just the pin
alone.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from domain.cds.manifest_compile import ManifestError, compile_manifest  # noqa: E402

EXPECTED_VERSION = "5.1.0"
EXPECTED_CONTENT_SHA256 = "6367c0fee822f4d07725abc7274c8a589edefd64fb7301eac8372568941b04ae"
CONFIG_DIR = Path(__file__).resolve().parents[1] / "config" / "cds"


def main() -> int:
    try:
        compiled = compile_manifest(CONFIG_DIR)
    except ManifestError as error:
        print(f"MANIFEST COMPILE FAILED: {error}", file=sys.stderr)
        return 1
    print(compiled.content_sha256)
    if compiled.version != EXPECTED_VERSION:
        print(
            f"VERSION MISMATCH: config/cds/manifest.yaml is {compiled.version!r} but the "
            f"pinned constant expects {EXPECTED_VERSION!r} -- a version edit without a "
            "matching repin of EXPECTED_CONTENT_SHA256 (see this script's docstring)",
            file=sys.stderr,
        )
        return 1
    if compiled.content_sha256 != EXPECTED_CONTENT_SHA256:
        print(
            f"MISMATCH: expected {EXPECTED_CONTENT_SHA256}, got {compiled.content_sha256}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
