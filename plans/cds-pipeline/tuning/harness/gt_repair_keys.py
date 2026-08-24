"""Normalize GT pass-file keys against the compiled manifest. Idempotent.

Why this exists: the `_specs/*.json` generator originally double-prefixed every
metric key (`student_life.student_life.foo`) because `manifest_compile` has already
domain-qualified `metric['id']`. The generator is fixed, but agents that had ALREADY
READ the old specs keep emitting the old form until they finish -- so pass files land
with stale keys for as long as those agents are in flight. Run this after every batch
of passes completes; running it twice is a no-op.

A double-prefixed key is not a cosmetic problem. Every such key fails the scorer's
manifest lookup, which silently degrades the metric to a text-comparison rule (or to
`uncovered` at scoring time) instead of raising. That is how six phantom
`value_conflict`s appeared in `student_life` where both passes had read the same
number off the same page.

Anything that cannot be resolved to a real manifest key is reported and left ALONE --
never dropped. An unresolvable key means a real authoring error worth a human look,
and silently deleting it would hide a missing metric.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from app.cds.manifest import load_compiled_manifest  # noqa: E402


def manifest_keys() -> set[str]:
    content = load_compiled_manifest().content
    keys: set[str] = set()
    for domain in content["domains"]:
        for metric in domain["metrics"]:
            mid = metric["id"]
            keys.add(mid if mid.startswith(f"{domain['id']}.") else f"{domain['id']}.{mid}")
    return keys


def repair_file(path: Path, valid: set[str]) -> tuple[int, int, list[str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    fixed: dict[str, object] = {}
    renamed = 0
    unknown: list[str] = []
    for key, entry in data.items():
        new_key = key
        if key not in valid:
            _, _, tail = key.partition(".")
            if tail in valid:
                new_key = tail
                renamed += 1
            else:
                unknown.append(key)
        if new_key in fixed and new_key != key:
            # Two source keys collapsing onto one target would silently drop data.
            unknown.append(f"{key} -> collides with existing {new_key}")
            continue
        fixed[new_key] = entry
    if renamed:
        path.write_text(json.dumps(fixed, indent=1), encoding="utf-8")
    return len(fixed), renamed, unknown


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="+", help="GT pass JSON files (globs already expanded)")
    args = ap.parse_args()

    valid = manifest_keys()
    print(f"manifest keys: {len(valid)}")
    total_unknown = 0
    for raw in args.paths:
        path = Path(raw)
        count, renamed, unknown = repair_file(path, valid)
        total_unknown += len(unknown)
        flag = "" if not unknown else f"  !! UNKNOWN={len(unknown)}"
        print(f"  {path.name:56s} n={count:3d} renamed={renamed:3d}{flag}")
        for item in unknown[:5]:
            print(f"       ?? {item}")
    if total_unknown:
        print(f"\n{total_unknown} key(s) could not be resolved and were left untouched.")
    return 1 if total_unknown else 0


if __name__ == "__main__":
    raise SystemExit(main())
