import fitz, sys
docs = {
    "uga": "artifacts/cds-corpus/uga_2023-2024.pdf",
    "ucf": "artifacts/cds-corpus/ucf_2023-2024.pdf",
}
jobs = [("uga", 3), ("uga", 36), ("ucf", 28)]
out = "plans/cds-pipeline/tuning/harness/scratch_adjudicate"
for key, pageno in jobs:
    d = fitz.open(docs[key])
    p = d[pageno-1]
    pix = p.get_pixmap(dpi=300)
    pix.save(f"{out}/{key}_p{pageno}.png")
    print(key, pageno, pix.width, pix.height)
