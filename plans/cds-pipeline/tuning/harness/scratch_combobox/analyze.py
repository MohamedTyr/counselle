import json

with open("plans/cds-pipeline/tuning/harness/scratch_combobox/widgets_raw.json") as f:
    widgets = json.load(f)


def classify(widget):
    value = widget["value"]
    choices = widget["choice_values"] or []
    pair_entries = [c for c in choices if isinstance(c, (list, tuple)) and len(c) == 2]
    has_pairs = len(pair_entries) > 0

    if not has_pairs:
        return "SAME", None, None

    # find the entry matching current value (match either export or display)
    matching = [c for c in pair_entries if c[0] == value]
    if not matching:
        # value might match display side, or not present at all (blank/unset)
        matching_display = [c for c in pair_entries if c[1] == value]
        if matching_display:
            matching = matching_display
        else:
            return "NO_MATCH", None, None

    export, display = matching[0]
    if export == display:
        return "PAIRS_BUT_EQUAL", export, display
    else:
        return "DIVERGENT", export, display


analysis = []
for w in widgets:
    status, export, display = classify(w)
    analysis.append(
        {
            "page": w["page"],
            "field_name": w["field_name"],
            "widget_type": w["widget_type"],
            "value": w["value"],
            "status": status,
            "export": export,
            "display": display,
        }
    )

with open("plans/cds-pipeline/tuning/harness/scratch_combobox/analysis.json", "w") as f:
    json.dump(analysis, f, indent=2, ensure_ascii=False)

from collections import Counter

print("Status counts:", Counter(a["status"] for a in analysis))
print()
print("=== DIVERGENT fields ===")
for a in analysis:
    if a["status"] == "DIVERGENT":
        print(a)
print()
print("=== NO_MATCH fields (value not found among options - likely blank/empty) ===")
for a in analysis:
    if a["status"] == "NO_MATCH":
        print(a)
print()
print("=== PAIRS_BUT_EQUAL fields ===")
for a in analysis:
    if a["status"] == "PAIRS_BUT_EQUAL":
        print(a)
