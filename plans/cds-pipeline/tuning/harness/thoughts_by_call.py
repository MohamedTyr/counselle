import json, sys
from pathlib import Path
for lbl in sys.argv[1:]:
    p = Path(f"plans/cds-pipeline/tuning/runs/{lbl}/caltech_2024-2025.json")
    d = json.loads(p.read_text())
    calls = d.get("calls") or []
    tot = sum((c.get("usage") or {}).get("thoughts_tokens", 0) for c in calls)
    print(f"--- {lbl}: {len(calls)} calls, total thoughts={tot} ---")
    rows = sorted(calls, key=lambda c: -(c.get("usage") or {}).get("thoughts_tokens", 0))[:6]
    for c in rows:
        u = c.get("usage") or {}
        hints = ",".join(sorted(c.get("hints") or []))[:32]
        dom = str(c.get("domain", "?"))[:14]
        th = u.get("thoughts_tokens", 0)
        out = u.get("output_tokens", 0)
        lat = c.get("latency_seconds", 0) or 0
        print(f"  {dom:14s} b{c.get('batch_index')} [{hints:32s}] thoughts={th:7d} out={out:6d} lat={lat:7.1f}")
