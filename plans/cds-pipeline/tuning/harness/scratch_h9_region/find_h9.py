import fitz, sys, json

DOCS = {
 "cornell": ("artifacts/cds-corpus/cornell_2022-2023.pdf", 23),
 "dartmouth": ("artifacts/cds-corpus/dartmouth_2024-2025.pdf", 23),
 "ucf": ("artifacts/cds-corpus/ucf_2023-2024.pdf", 32),
}

for name,(path,hint) in DOCS.items():
    doc = fitz.open(path)
    print("="*70)
    print(name, path, "pages:", doc.page_count)
    hits=[]
    for i,page in enumerate(doc):
        t = page.get_text()
        low = t.lower()
        if "h9" in low or "priority date" in low or "deadline for filing" in low:
            hits.append(i)
    print("candidate pages (0-based):", hits)
    for i in hits:
        page = doc[i]
        print(f"--- page idx {i} (1-based {i+1}) widgets={len(list(page.widgets()))} annots={len(list(page.annots()))}")
    doc.close()
