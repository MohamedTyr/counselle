import pymupdf

docs = {
    "uga": "artifacts/cds-corpus/uga_2023-2024.pdf",
    "caltech": "artifacts/cds-corpus/caltech_2024-2025.pdf",
}
PAGE_INDEX = 36

for name, path in docs.items():
    doc = pymupdf.open(path)
    page = doc[PAGE_INDEX]
    print(f"=== {name} ===")
    for needle in ("H14", "Non-Need", "Need-Based", "Academics", "State/district", "residency", "Applicable"):
        rects = page.search_for(needle)
        print(f"  search '{needle}': {rects}")
    doc.close()
