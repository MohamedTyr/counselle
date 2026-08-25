import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import scorer
from collections import Counter
SUB = {"cornell_2022-2023":"exp32-corpus","dartmouth_2024-2025":"exp32-rerun",
       "ucf_2023-2024":"exp32-corpus","uga_2023-2024":"exp32-corpus",
       "caltech_2024-2025":"exp32-rerun"}
RUNS = Path("plans/cds-pipeline/tuning/runs"); GT = Path("plans/cds-pipeline/tuning/gt")
rows = []
for d, lbl in SUB.items():
    rep = scorer.score_run(json.loads((RUNS/lbl/f"{d}.json").read_text()),
                           scorer.load_ground_truth(GT/f"{d}.json"))
    for c in rep["comparisons"]:
        if c.get("outcome") in ("wrong", "hallucinated"):
            rows.append((d.split("_")[0], c.get("metric_id","?"), c["outcome"],
                         str(c.get("engine_value"))[:22], str(c.get("gt_value"))[:22]))
print(f"TOTAL {len(rows)} errors\n")
for r in sorted(rows, key=lambda x: (x[2], x[1])):
    print(f"  {r[0]:10s} {r[1].split('.')[-1][:44]:44s} {r[2]:13s} eng={r[3]:22s} gt={r[4]}")
