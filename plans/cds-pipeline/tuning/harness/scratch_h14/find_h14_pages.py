import pymupdf

docs = {
    "uga_2023-2024": "artifacts/cds-corpus/uga_2023-2024.pdf",
    "caltech_2024-2025": "artifacts/cds-corpus/caltech_2024-2025.pdf",
}

for name, path in docs.items():
    doc = pymupdf.open(path)
    print(f"=== {name} ({doc.page_count} pages, 0-indexed by pymupdf) ===")
    for i in range(doc.page_count):
        page = doc[i]
        text = page.get_text()
        if "H14" in text:
            print(f"  pymupdf page index {i} (1-based page number {i+1}) contains 'H14'")
            # print small snippet around H14
            idx = text.find("H14")
            print("   snippet:", repr(text[max(0,idx-40):idx+120]))
    doc.close()
