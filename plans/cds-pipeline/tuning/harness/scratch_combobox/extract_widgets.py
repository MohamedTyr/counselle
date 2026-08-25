import json
import pymupdf as fitz

PDF_PATH = "artifacts/cds-corpus/uga_2023-2024.pdf"

WIDGET_TYPE_NAMES = {
    fitz.PDF_WIDGET_TYPE_COMBOBOX: "COMBOBOX",
    fitz.PDF_WIDGET_TYPE_LISTBOX: "LISTBOX",
}

doc = fitz.open(PDF_PATH)

results = []
for page_index in range(len(doc)):
    page = doc[page_index]
    for widget in page.widgets() or []:
        if widget.field_type in WIDGET_TYPE_NAMES:
            entry = {
                "page": page_index + 1,  # 1-indexed for human reporting
                "field_name": widget.field_name,
                "widget_type": WIDGET_TYPE_NAMES[widget.field_type],
                "field_type_string": widget.field_type_string,
                "value": widget.field_value,
                "choice_values": widget.choice_values,
            }
            results.append(entry)

print(f"Total choice widgets found: {len(results)}")
print(json.dumps(results, indent=2, ensure_ascii=False))

with open(
    "plans/cds-pipeline/tuning/harness/scratch_combobox/widgets_raw.json", "w"
) as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
