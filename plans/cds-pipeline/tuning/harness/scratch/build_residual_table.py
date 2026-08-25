"""Scratch script: build the residual error table for the exp15-clean champion.

Reads the five persisted champion run files (four from exp15-grids-full, one
Cornell re-run from exp16-noise), scores each against its ground truth with
scorer.score_run, and dumps everything needed for the residual tables as JSON
to stdout: per-document run_errors, and lists of wrong/hallucinated/missed
comparisons annotated with the manifest's source_hints.
"""

import json
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS_DIR))

import scorer  # noqa: E402

TUNING = HARNESS_DIR.parent
RUNS = {
    "caltech_2024-2025": TUNING / "runs/exp15-grids-full/caltech_2024-2025.json",
    "dartmouth_2024-2025": TUNING / "runs/exp15-grids-full/dartmouth_2024-2025.json",
    "ucf_2023-2024": TUNING / "runs/exp15-grids-full/ucf_2023-2024.json",
    "uga_2023-2024": TUNING / "runs/exp15-grids-full/uga_2023-2024.json",
    "cornell_2022-2023": TUNING / "runs/exp16-noise/cornell_2022-2023.json",
}
GT_DIR = TUNING / "gt"

# Build metric universe once (also gives us source_hints per metric key).
universe = scorer.manifest_universe()


def source_prefix(domain: str, metric_id: str) -> tuple[str, bool]:
    """Return (prefix, derived) where derived=True means we had to fall back."""
    metric = universe.get((domain, metric_id))
    hints = metric.get("source_hints") if metric else None
    if hints:
        return str(hints[0]), False
    return f"{domain}.{metric_id}", True


results = {}
totals = {"correct": 0, "wrong": 0, "missed": 0, "hallucinated": 0}
run_errors = {}
table_a = []  # wrong
table_b = []  # hallucinated
table_c = []  # missed
derived_any = False

for doc, run_path in RUNS.items():
    gt_path = GT_DIR / f"{doc}.json"
    run = json.loads(run_path.read_text())
    gt = scorer.load_ground_truth(gt_path)
    rep = scorer.score_run(run, gt, universe=universe)
    summary = scorer.summarize(rep)

    run_errors[doc] = len(rep.get("run_errors") or [])

    t = rep["totals"]
    for k in totals:
        totals[k] += t.get(k, 0)

    for c in rep["comparisons"]:
        outcome = c["outcome"]
        domain = c["domain"]
        metric_id = c["metric_id"]
        prefix, derived = source_prefix(domain, metric_id)
        if derived:
            derived_any = True
        if outcome == "wrong":
            table_a.append(
                {
                    "document": doc,
                    "metric_id": f"{domain}.{metric_id}",
                    "domain": domain,
                    "engine_value": c.get("engine_value"),
                    "gt_value": c.get("gt_value"),
                    "engine_page": c.get("engine_page"),
                    "gt_page": c.get("gt_page"),
                    "prefix": prefix,
                    "prefix_derived": derived,
                }
            )
        elif outcome == "hallucinated":
            table_b.append(
                {
                    "document": doc,
                    "metric_id": f"{domain}.{metric_id}",
                    "domain": domain,
                    "engine_value": c.get("engine_value"),
                    "gt_status": c.get("gt_status"),
                    "engine_page": c.get("engine_page"),
                    "prefix": prefix,
                    "prefix_derived": derived,
                }
            )
        elif outcome == "missed":
            table_c.append(
                {
                    "document": doc,
                    "metric_id": f"{domain}.{metric_id}",
                    "domain": domain,
                    "gt_value": c.get("gt_value"),
                    "gt_page": c.get("gt_page"),
                    "prefix": prefix,
                    "prefix_derived": derived,
                }
            )

    results[doc] = {"totals": t, "summary": summary}

out = {
    "totals": totals,
    "run_errors": run_errors,
    "table_a_wrong": table_a,
    "table_b_hallucinated": table_b,
    "table_c_missed": table_c,
    "per_doc": results,
}

print(json.dumps(out, indent=2, default=str))
