"""Aggregate a config across the 5 tuning documents. Usage:
   uv run python .../score_corpus.py <label> [doc=label_override ...]
Substitutions let a clean re-run stand in for a document whose run in
<label> carried a failed call (the exp16 precedent)."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import scorer

DOCS = ["cornell_2022-2023", "dartmouth_2024-2025", "ucf_2023-2024",
        "uga_2023-2024", "caltech_2024-2025"]
RUNS = Path("plans/cds-pipeline/tuning/runs")
GT = Path("plans/cds-pipeline/tuning/gt")

label = sys.argv[1]
subs = dict(a.split("=", 1) for a in sys.argv[2:])

tot = {"correct": 0, "wrong": 0, "missed": 0, "hallucinated": 0, "correct_abstention": 0}
present = extracted = 0
costs, lats, errs = [], [], 0
print(f"=== {label} ===")
for d in DOCS:
    lbl = subs.get(d, label)
    rep = scorer.score_run(json.loads((RUNS / lbl / f"{d}.json").read_text()),
                           scorer.load_ground_truth(GT / f"{d}.json"))
    t = rep["totals"]
    for k in tot:
        tot[k] += t[k]
    present += t["present_in_document"]
    extracted += t["extracted_on_present"]
    ne = len(rep.get("run_errors") or [])
    errs += ne
    costs.append(rep["fitness"][3]); lats.append(rep["fitness"][4])
    flag = f"  !! {ne} FAILED CALLS" if ne else ""
    src = f" (from {lbl})" if lbl != label else ""
    print(f"  {d:22s} acc={t['accuracy_pct']:6.2f} cov={t['coverage_pct']:6.2f} "
          f"c={t['correct']:4d} w={t['wrong']:3d} m={t['missed']:3d} h={t['hallucinated']:3d}{flag}{src}")
den = tot["correct"] + tot["wrong"] + tot["hallucinated"]
print(f"  AGGREGATE accuracy={100*tot['correct']/den:.2f}%  coverage={100*extracted/present:.2f}%")
print(f"  buckets {tot}")
print(f"  cost/doc=${-sum(costs)/5:.4f}  latency/doc={-sum(lats)/5:.1f}s  failed_calls={errs}")
