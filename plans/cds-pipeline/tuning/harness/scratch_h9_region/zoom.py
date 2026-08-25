import pymupdf
OUT="plans/cds-pipeline/tuning/harness/scratch_h9_region/"
Z = {
 "cornell_box": ("artifacts/cds-corpus/cornell_2022-2023.pdf",22,(70,160,120,182)),
 "cornell_lines": ("artifacts/cds-corpus/cornell_2022-2023.pdf",22,(240,130,330,162)),
 "dartmouth_box": ("artifacts/cds-corpus/dartmouth_2024-2025.pdf",21,(72,617,125,640)),
 "ucf_yes": ("artifacts/cds-corpus/ucf_2023-2024.pdf",31,(395,465,500,545)),
}
for n,(p,pi,c) in Z.items():
    d=pymupdf.open(p); pg=d[pi]
    pg.get_pixmap(dpi=900, clip=pymupdf.Rect(*c)).save(OUT+n+".png"); print(n,"ok")
