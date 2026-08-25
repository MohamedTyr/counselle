import pymupdf
DOCS = {
 "cornell": ("artifacts/cds-corpus/cornell_2022-2023.pdf", 22),
 "dartmouth": ("artifacts/cds-corpus/dartmouth_2024-2025.pdf", 21),
 "ucf": ("artifacts/cds-corpus/ucf_2023-2024.pdf", 31),
}
for name,(path,pi) in DOCS.items():
    doc = pymupdf.open(path)
    page = doc[pi]
    print("="*80); print(name, "page idx", pi, "rect", page.rect)
    d = page.get_text("dict")
    for b in d["blocks"]:
        if b["type"]!=0: 
            print("  IMAGE BLOCK bbox", b["bbox"]); continue
        for l in b["lines"]:
            txt = "".join(s["text"] for s in l["spans"])
            if txt.strip():
                x0,y0,x1,y1 = l["bbox"]
                print(f"  [{x0:7.1f},{y0:7.1f},{x1:7.1f},{y1:7.1f}] {txt!r}")
    doc.close()
