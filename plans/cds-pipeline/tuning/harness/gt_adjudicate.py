"""Diff two independent ground-truth passes and emit an adjudication worklist.

OFFLINE GT TOOLING. Nothing here touches the runtime pipeline or the database.

Per the tuning prompt's §4, ground truth is produced by two independent passes over
the same pages; this script is the mechanical step between "two passes exist" and
"a human/orchestrator adjudicates the real disagreements". Its whole job is to
shrink the adjudication worklist to the cases that genuinely need judgement.

Design rule, inherited from the scorer: **this module does not define its own notion
of equality.** It imports `normalize()` / `compare_metric()` from `scorer.py`
verbatim, so two passes agreeing under the scorer's rules are exactly the two passes
that will score identically against a run. Reimplementing the comparison here would
let GT drift from the yardstick that consumes it -- the two would disagree silently
and the loop would chase phantom deltas.

Consequences of that rule worth stating out loud:

* A pass writing `43` and a pass writing `"43%"` is NOT a disagreement if the scorer
  normalizes them together. Surfacing it would waste adjudication effort.
* Conversely, if the scorer is strict about something, this script is strict about it
  too, and the disagreement gets adjudicated rather than silently smoothed over.

Disagreement classes, most to least serious:

  value_conflict   both passes say `present` and the values do NOT match. The real
                   work. One pass misread the page, or the metric is genuinely
                   ambiguous on the page.
  status_conflict  the passes disagree on status (e.g. `absent` vs `blank`). These
                   are usually a template-edition judgement, and they matter: the
                   scorer treats `absent`/`blank` as correct-abstention territory,
                   so getting this wrong mislabels engine behaviour.
  coverage_gap     a key present in one pass and missing from the other. Always a
                   process failure (a stalled agent, a truncated write), never a
                   reading disagreement -- fix by re-running the missing slice.
  ambiguous_flag   at least one pass set `"ambiguous": true`. Not a conflict, but
                   the passes flagged it as a judgement call; review even when they
                   agree, because two passes can agree on the same misreading.

Exit status is 0 even when conflicts exist -- conflicts are the expected output, not
an error. A non-zero exit means the inputs were unusable.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from collections.abc import Mapping
from typing import Any

import scorer

_STATUSES = ("present", "blank", "absent", "unreadable")


def _load(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{path}: expected a JSON object keyed by metric id")
    return data


def _values_agree(a: Any, b: Any, metric: Mapping[str, Any] | None) -> tuple[bool, str]:
    """Agreement under the SCORER's own `normalize()`, not a rule invented here.

    Returns `(agree, note)`. `note` carries why a comparison could not be made
    cleanly, so an unparseable GT value surfaces as a *reviewable* disagreement
    rather than silently collapsing to "equal" or "not equal".

    An unparseable value on either side is never treated as agreement even if
    both sides are unparseable in the same way: the scorer quarantines
    unparseable `present` ground truth as `gt_error`, so shipping such a value
    into a sealed GT file guarantees a metric the engine can never win.
    """
    if metric is None:
        return (a == b, "metric not in manifest; fell back to raw equality")
    na = scorer.normalize(a, metric)
    nb = scorer.normalize(b, metric)
    if na.unparseable or nb.unparseable:
        sides = [lbl for lbl, n in (("A", na), ("B", nb)) if n.unparseable]
        return (False, f"unparseable under the scorer's rule on pass {'+'.join(sides)}")
    return (na.canonical == nb.canonical and na.absent == nb.absent, "")


def adjudicate(
    pass_a: dict[str, Any],
    pass_b: dict[str, Any],
    universe: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    keys_a, keys_b = set(pass_a), set(pass_b)
    report: dict[str, list[dict[str, Any]]] = {
        "value_conflict": [],
        "status_conflict": [],
        "coverage_gap": [],
        "ambiguous_flag": [],
    }

    for key in sorted(keys_a ^ keys_b):
        report["coverage_gap"].append(
            {"key": key, "present_in": "A" if key in keys_a else "B"}
        )

    agreed = 0
    for key in sorted(keys_a & keys_b):
        a, b = pass_a[key], pass_b[key]
        sa, sb = a.get("status"), b.get("status")
        for label, status in (("A", sa), ("B", sb)):
            if status not in _STATUSES:
                report["status_conflict"].append(
                    {"key": key, "reason": f"pass {label} has invalid status {status!r}"}
                )

        if sa != sb:
            report["status_conflict"].append(
                {
                    "key": key,
                    "A": {"status": sa, "value": a.get("value"), "page": a.get("page"),
                          "evidence": a.get("evidence")},
                    "B": {"status": sb, "value": b.get("value"), "page": b.get("page"),
                          "evidence": b.get("evidence")},
                }
            )
        elif sa == "present":
            metric = universe.get(scorer.metric_key(None, key))
            same, note = _values_agree(a.get("value"), b.get("value"), metric)
            if same:
                agreed += 1
            else:
                report["value_conflict"].append(
                    {
                        "key": key,
                        "unit": (metric or {}).get("unit"),
                        "note": note,
                        "A": {"value": a.get("value"), "page": a.get("page"),
                              "evidence": a.get("evidence")},
                        "B": {"value": b.get("value"), "page": b.get("page"),
                              "evidence": b.get("evidence")},
                    }
                )
        else:
            agreed += 1

        if a.get("ambiguous") or b.get("ambiguous"):
            report["ambiguous_flag"].append(
                {
                    "key": key,
                    "flagged_by": [
                        lbl for lbl, p in (("A", a), ("B", b)) if p.get("ambiguous")
                    ],
                    "A": {"value": a.get("value"), "evidence": a.get("evidence")},
                    "B": {"value": b.get("value"), "evidence": b.get("evidence")},
                }
            )

    total = len(keys_a | keys_b)
    conflicts = sum(len(v) for k, v in report.items() if k != "ambiguous_flag")
    return {
        "totals": {
            "keys_union": total,
            "keys_both": len(keys_a & keys_b),
            "agreed": agreed,
            "conflicts": conflicts,
            "ambiguous_flagged": len(report["ambiguous_flag"]),
            "agreement_pct": round(100.0 * agreed / total, 2) if total else None,
        },
        **report,
    }


def _universe() -> dict[tuple[str, str], dict[str, Any]]:
    """The metric universe, straight from the scorer -- never a local rebuild."""
    return scorer.manifest_universe()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pass_a")
    ap.add_argument("pass_b")
    ap.add_argument("--out", help="write the full JSON worklist here")
    args = ap.parse_args()

    a, b = _load(Path(args.pass_a)), _load(Path(args.pass_b))
    report = adjudicate(a, b, _universe())

    t = report["totals"]
    print(f"keys: union={t['keys_union']} both={t['keys_both']} agreed={t['agreed']} "
          f"({t['agreement_pct']}%)")
    print(f"value_conflict={len(report['value_conflict'])}  "
          f"status_conflict={len(report['status_conflict'])}  "
          f"coverage_gap={len(report['coverage_gap'])}  "
          f"ambiguous={len(report['ambiguous_flag'])}")
    for cls in ("coverage_gap", "value_conflict", "status_conflict"):
        for item in report[cls][:40]:
            print(f"  [{cls}] {item.get('key')}")

    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1), encoding="utf-8")
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
