import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import scorer
run, gt = Path(sys.argv[1]), Path(sys.argv[2])
rep = scorer.score_run(json.loads(run.read_text()), scorer.load_ground_truth(gt))
t = rep["totals"]
print(f"{run.parent.name:22s} {run.stem}")
print("  totals:", {k: v for k, v in t.items()})
print("  fitness:", rep.get("fitness"), "fields:", rep.get("fitness_fields"))
print("  valid:", rep.get("valid"), " failed_call_count:", rep.get("failed_call_count"))
print("  run_errors:", len(rep.get("run_errors") or []))
fam = {}
for c in rep["comparisons"]:
    o = c.get("outcome")
    if o in ("wrong", "missed", "hallucinated"):
        mid = c.get("metric_id") or c.get("id") or "?"
        key = "H14" if ".h14_" in mid else mid.split(".")[0]
        fam.setdefault(key, {}).setdefault(o, 0)
        fam[key][o] += 1
print("  by family:", json.dumps(fam, sort_keys=True))
