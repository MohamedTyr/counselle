import json, sys
from pathlib import Path
DOCS = {"cornell_2022-2023": 32, "dartmouth_2024-2025": 34, "ucf_2023-2024": 48,
        "uga_2023-2024": 50, "caltech_2024-2025": 50}
RUNS = Path("plans/cds-pipeline/tuning/runs")
IN_P, OUT_P = 0.25, 1.50
tot = {"prompt": 0, "output": 0, "pages": 0, "docpages": 0, "calls": 0}
for d, npages in DOCS.items():
    lbl = "exp16-noise" if d == "cornell_2022-2023" else "exp15-grids-full"
    calls = json.loads((RUNS / lbl / f"{d}.json").read_text()).get("calls") or []
    p = sum((c.get("usage") or {}).get("prompt_tokens", 0) for c in calls)
    o = sum((c.get("usage") or {}).get("output_tokens", 0) for c in calls)
    ps = sum(c.get("pages_sent", 0) for c in calls)
    tot["prompt"] += p; tot["output"] += o; tot["pages"] += ps
    tot["docpages"] += npages; tot["calls"] += len(calls)
    print(f"  {d:22s} pages_sent={ps:4d} / {npages:3d}pp = {ps/npages:4.1f}x   "
          f"in=${p/1e6*IN_P:.4f} out=${o/1e6*OUT_P:.4f}")
n = len(DOCS)
cin, cout = tot["prompt"]/1e6*IN_P/n, tot["output"]/1e6*OUT_P/n
print(f"\nPER DOC: input=${cin:.4f}  output=${cout:.4f}  total=${cin+cout:.4f}")
print(f"  page redundancy {tot['pages']/tot['docpages']:.2f}x  ({tot['pages']} sends / {tot['docpages']} pages)")
print(f"  output tokens/metric = {tot['output']/(394*n):.1f}")
# headroom
pg_tok = 592 * tot["pages"] / n
ideal_pg_tok = 592 * tot["docpages"] / n
save_pages = (pg_tok - ideal_pg_tok)/1e6*IN_P
print(f"\nLEVER 2 ceiling (perfect page dedup, 1 send/page): save ${save_pages:.4f}/doc")
print(f"LEVER 5 at -50% output tokens:                     save ${cout*0.5:.4f}/doc")
base = cin + cout
print(f"\nbase ${base:.4f} -> ${base-save_pages-cout*0.5:.4f} with BOTH maxed")
print(f"  + deliberation $0.0944 = ${base-save_pages-cout*0.5+0.0944:.4f}   (floor $0.15)")
