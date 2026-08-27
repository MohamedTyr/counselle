"""Parse the 13 per-domain keep tables in specs/cds-pipeline/METRICS-KEEP.md.

Returns (domain, id) pairs -- ids are only unique *within* a domain
(applicants_total/admitted_total/enrolled_total live in both admissions and
transfer), so a flat set of id strings is wrong.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
KEEP_MD = ROOT / "specs" / "cds-pipeline" / "METRICS-KEEP.md"

_HEADER = re.compile(r"^## (?P<domain>[a-z_]+) — keep (?P<keep>\d+) of (?P<total>\d+)\s*$")
_ROW = re.compile(r"^\|\s*`(?P<id>[A-Za-z0-9_]+)`\s*\|")


def parse_keep(path: Path = KEEP_MD) -> tuple[set[tuple[str, str]], dict[str, int]]:
    pairs: set[tuple[str, str]] = set()
    declared: dict[str, int] = {}
    domain: str | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        header = _HEADER.match(line)
        if header:
            domain = header["domain"]
            declared[domain] = int(header["keep"])
            continue
        if line.startswith("## "):
            domain = None
            continue
        if domain is None:
            continue
        row = _ROW.match(line)
        if row:
            pairs.add((domain, row["id"]))
    return pairs, declared


if __name__ == "__main__":
    pairs, declared = parse_keep()
    import collections

    counts = collections.Counter(d for d, _ in pairs)
    for d in sorted(declared):
        flag = "OK" if counts[d] == declared[d] else "MISMATCH"
        print(f"{d:16} parsed={counts[d]:4} declared={declared[d]:4}  {flag}")
    print(f"TOTAL parsed={len(pairs)} declared={sum(declared.values())}")
