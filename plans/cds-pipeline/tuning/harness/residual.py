import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import scorer
from collections import Counter
DOCS = ["cornell_2022-2023","dartmouth_2024-2025","ucf_2023-2024","uga_2023-2024","caltech_2024-2025"]
RUNS = Path("plans/cds-pipeline/tuning/runs"); GT = Path("plans/cds-pipeline/tuning/gt")
label = sys.argv[1]; subs = dict(a.split("=",1) for a in sys.argv[2:])
mf = json.loads(Path("config/cds/compiled-manifest.json").read_text()) if Path("config/cds/compiled-manifest.json").exists() else None
hints = {}
if mf:
    for dom in mf.get("domains", []):
        for m in dom.get("metrics", []):
            hints[m["id"]] = (m.get("source_hints") or ["?"])[0]
fam = Counter(); rows = []
for d in DOCS:
    rep = scorer.score_run(json.loads((RUNS/subs.get(d,label)/f"{d}.json").read_text()),
                           scorer.load_ground_truth(GT/f"{d}.json"))
    for c in rep["comparisons"]:
        if c.get("outcome") in ("wrong","hallucinated"):
            mid = c.get("metric_id","?")
            h = hints.get(mid, mid.split(".")[0])
            fam[(h, c["outcome"])] += 1
            rows.append((d.split("_")[0], mid.split(".")[-1][:38], c["outcome"], str(c.get("engine_value"))[:14], str(c.get("gt_value"))[:14]))
print(f"=== {label}: wrong+hallucinated by source-hint family ===")
for (h,o),n in fam.most_common(14):
    print(f"  {h:8s} {o:14s} {n}")
print(f"\n=== all {len(rows)} rows ===")
for r in sorted(rows):
    print(f"  {r[0]:10s} {r[1]:38s} {r[2]:13s} engine={r[3]:14s} gt={r[4]}")
