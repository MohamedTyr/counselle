"""Re-seal uga identity.state_or_region per the 2026-08-25 adjudication:
the page and the ComboBox DISPLAY label both read 'Georgia'; 'GA' is the
widget's export value, which the catalog ("copy exactly as printed") does not ask
for. Ruling was GT_ERROR with high confidence and visual evidence."""
import json
from pathlib import Path
p = Path("plans/cds-pipeline/tuning/gt/uga_2023-2024.json")
raw = json.loads(p.read_text())
ents = raw.get("metrics", raw)
k = "identity.state_or_region"
before = dict(ents[k])
ents[k]["value"] = "Georgia"
ents[k]["evidence"] = (
    "STATE_CODE ComboBox: export value 'GA', rendered display label 'Georgia' "
    "[RE-SEALED: catalog says copy exactly as printed; the page renders 'Georgia'. "
    "Adjudicated 2026-08-25, GT_ERROR, high confidence]"
)
ents[k]["source"] = "acroform+adjudication"
p.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
print("before:", before)
print("after :", ents[k])
print("total metrics:", len(ents))
