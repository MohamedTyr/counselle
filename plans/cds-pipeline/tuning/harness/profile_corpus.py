import json
import re
import unicodedata
from pathlib import Path

import pymupdf

CORPUS = Path("artifacts/cds-corpus")
OUT = Path("plans/cds-pipeline/tuning/corpus-profile.json")

ANCHORS = ["A1", "B1", "C1", "C7", "C9", "D1", "E1", "F1", "G1", "H1", "H2", "I1", "I2", "I3", "J1"]


def anchor_pattern(anchor: str) -> re.Pattern:
    letter, num = anchor[0], anchor[1:]
    return re.compile(rf"\b{letter}[\s\-]?{num}\b")


def is_control_char(ch: str) -> bool:
    if ch in ("\n", "\t", "\r", " "):
        return False
    cat = unicodedata.category(ch)
    return cat.startswith("C")


def profile_pdf(path: Path) -> dict:
    size_mb = round(path.stat().st_size / (1024 * 1024), 3)
    doc = pymupdf.open(path)
    page_count = doc.page_count

    meta = doc.metadata or {}
    producer = meta.get("producer", "")
    creator = meta.get("creator", "")

    # AcroForm fields
    field_names = []
    try:
        for widget_page in doc:
            for widget in widget_page.widgets() or []:
                if widget.field_name:
                    field_names.append(widget.field_name)
    except Exception as e:
        field_names = [f"__error__:{e}"]
    field_count = len(field_names)
    field_names_sample = field_names[:15]

    total_chars = 0
    total_control = 0
    pages_gt2_control = 0
    pages_lt20_chars = 0
    page_texts = []
    for i, page in enumerate(doc):
        text = page.get_text()
        page_texts.append(text)
        n_chars = len(text)
        n_control = sum(1 for ch in text if is_control_char(ch))
        total_chars += n_chars
        total_control += n_control
        if n_control > 2:
            pages_gt2_control += 1
        if n_chars < 20:
            pages_lt20_chars += 1

    page1_excerpt = page_texts[0][:200].replace("\n", "\\n") if page_texts else ""
    mid_idx = page_count // 2
    mid_excerpt = page_texts[mid_idx][:200].replace("\n", "\\n") if page_texts else ""

    anchors_found = {}
    for anchor in ANCHORS:
        pat = anchor_pattern(anchor)
        pages_hit = [i + 1 for i, t in enumerate(page_texts) if pat.search(t)]
        if pages_hit:
            anchors_found[anchor] = pages_hit

    doc.close()

    return {
        "filename": path.name,
        "size_mb": size_mb,
        "page_count": page_count,
        "producer": producer,
        "creator": creator,
        "acroform_field_count": field_count,
        "acroform_field_names_sample": field_names_sample,
        "total_chars": total_chars,
        "total_control_chars": total_control,
        "pages_gt2_control_chars": pages_gt2_control,
        "pages_lt20_chars": pages_lt20_chars,
        "page1_excerpt": page1_excerpt,
        "mid_page_index": mid_idx + 1,
        "mid_page_excerpt": mid_excerpt,
        "anchors_found": anchors_found,
        "anchor_count": len(anchors_found),
    }


def main() -> None:
    pdfs = sorted(CORPUS.glob("*.pdf"))
    results = [profile_pdf(p) for p in pdfs]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, indent=2))
    print(f"Wrote {len(results)} profiles to {OUT}")


if __name__ == "__main__":
    main()
