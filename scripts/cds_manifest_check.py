#!/usr/bin/env python3
"""Recompile ``config/cds/`` and assert the content hash matches the live manifest.

This is the P1 hard gate (plan §B2, Risk 1): a byte-for-byte identical
``content_sha256`` proves the port is correct without needing to republish a
new manifest version. If this ever prints a different hash, **stop** — do not
"just publish a new version" and do not adjust the expected constant here; see
``plans/cds-pipeline/PLAN.md`` §B2 for the escalation path.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from domain.cds.manifest_compile import ManifestError, compile_manifest  # noqa: E402

EXPECTED_CONTENT_SHA256 = "ae78912f23f693a3bd11313b798ccd957b93eaf51c9e1574a29b4470fc421196"
CONFIG_DIR = Path(__file__).resolve().parents[1] / "config" / "cds"


def main() -> int:
    try:
        compiled = compile_manifest(CONFIG_DIR)
    except ManifestError as error:
        print(f"MANIFEST COMPILE FAILED: {error}", file=sys.stderr)
        return 1
    print(compiled.content_sha256)
    if compiled.content_sha256 != EXPECTED_CONTENT_SHA256:
        print(
            f"MISMATCH: expected {EXPECTED_CONTENT_SHA256}, got {compiled.content_sha256}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
