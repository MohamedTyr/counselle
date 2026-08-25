import pymupdf
OUT="plans/cds-pipeline/tuning/harness/scratch_h9_region/"
for n,(p,pi,c) in {
 "cornell_wide":("artifacts/cds-corpus/cornell_2022-2023.pdf",22,(40,112,612,196)),
 "dartmouth_wide":("artifacts/cds-corpus/dartmouth_2024-2025.pdf",21,(40,560,612,654)),
 "ucf_wide":("artifacts/cds-corpus/ucf_2023-2024.pdf",31,(40,440,612,552)),
}.items():
    d=pymupdf.open(p); d[pi].get_pixmap(dpi=300, clip=pymupdf.Rect(*c)).save(OUT+n+".png"); print(n)
