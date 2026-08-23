"""Shrink config/cds/domains/*.yaml in place to the 394-metric keep set.

Pure line surgery: entries are deleted, nothing is reformatted or reordered, so
the diff is deletions only. Handles both authoring forms -- the block ``- id:``
list used by 12 domains and the inline ``- {id: ...}`` mapping used by
enrollment.yaml for all 134 of its metrics.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from keep_set import ROOT, parse_keep  # noqa: E402

DOMAINS = ROOT / "config" / "cds" / "domains"
TOP_KEY = re.compile(r"^[a-z_]+:")
METRIC_ENTRY = re.compile(r"^  - (?:id: (?P<block>[A-Za-z0-9_]+)|\{id: (?P<inline>[A-Za-z0-9_]+),)")


def _region(lines: list[str], key: str) -> tuple[int, int] | None:
    """(start, end) exclusive line range of a top-level key's body."""
    try:
        head = lines.index(f"{key}:")
    except ValueError:
        return None
    end = len(lines)
    for index in range(head + 1, len(lines)):
        if TOP_KEY.match(lines[index]):
            end = index
            break
    return head, end


def _split(lines: list[str], start: int, end: int, marker: str) -> list[tuple[int, int]]:
    """Line spans of each list entry, each extended backwards over the blank lines
    and ``#`` section comments that introduce it. Attaching that preamble to the
    entry *below* it is what stops a deleted section from leaving its heading
    comment orphaned above an unrelated surviving metric."""
    heads = [i for i in range(start, end) if lines[i].startswith(marker)]
    tops: list[int] = []
    for head in heads:
        top = head
        floor = tops[-1] + 1 if tops else start
        while top > floor:
            candidate = lines[top - 1].strip()
            if candidate and not candidate.startswith("#"):
                break
            top -= 1
        tops.append(top)
    return [(top, tops[n + 1] if n + 1 < len(tops) else end) for n, top in enumerate(tops)]


def cut_domain(path: Path, keep: set[tuple[str, str]]) -> dict:
    raw = path.read_text(encoding="utf-8")
    lines = raw.split("\n")
    domain_id = yaml.safe_load(raw)["id"]
    kept_ids = {mid for dom, mid in keep if dom == domain_id}
    drop: set[int] = set()
    report: dict = {"domain": domain_id, "bindings": []}

    metrics_head, metrics_end = _region(lines, "metrics")
    before = after = 0
    for head, tail in _split(lines, metrics_head + 1, metrics_end, "  - "):
        match = next(
            (m for m in (METRIC_ENTRY.match(line) for line in lines[head:tail]) if m), None
        )
        if match is None:
            raise SystemExit(f"{path}: unparsable metric entry near line {head + 1}")
        metric_id = match["block"] or match["inline"]
        before += 1
        if metric_id in kept_ids:
            after += 1
        else:
            drop.update(range(head, tail))
    report["before"], report["after"] = before, after

    bounds = _region(lines, "context_bindings")
    if bounds is not None:
        cb_head, cb_end = bounds
        survivors = 0
        for head, tail in _split(lines, cb_head + 1, cb_end, "- "):
            block = yaml.safe_load("\n".join(lines[head:tail]))[0]
            targets = block["targets"]["metric_ids"]
            entry = {
                "id": block["id"],
                "binders": block["binders"],
                "targets_before": len(targets),
            }
            dead_binders = [b for b in block["binders"] if b not in kept_ids]
            surviving = [t for t in targets if t in kept_ids]
            if dead_binders:
                entry.update(rule="R3a", disposition="DELETED", dead_binders=dead_binders)
                drop.update(range(head, tail))
            elif not surviving:
                entry.update(rule="R3c", disposition="DELETED", targets_after=0)
                drop.update(range(head, tail))
            else:
                entry.update(rule="R3b", disposition="KEPT", targets_after=len(surviving))
                survivors += 1
                for index in range(head, tail):
                    stripped = lines[index]
                    if stripped.startswith("    - ") and stripped[6:].strip() not in kept_ids:
                        drop.add(index)
            report["bindings"].append(entry)
        if survivors == 0:
            drop.update(range(cb_head, cb_end))
            report["context_bindings_key_removed"] = True

    kept = "\n".join(line for i, line in enumerate(lines) if i not in drop)
    if raw.endswith("\n") and not kept.endswith("\n"):
        kept = kept.rstrip("\n") + "\n"
    path.write_text(kept, encoding="utf-8")
    return report


def main() -> None:
    keep, _ = parse_keep()
    reports = [cut_domain(p, keep) for p in sorted(DOMAINS.glob("*.yaml"))]
    (HERE / "cut-report.yaml").write_text(yaml.safe_dump(reports, sort_keys=False))
    for report in reports:
        print(f"{report['domain']:16} {report['before']:5} -> {report['after']:4}")
    print("total", sum(r["before"] for r in reports), "->", sum(r["after"] for r in reports))


if __name__ == "__main__":
    main()
