import pymupdf
# interior of the drawn box, inset 1.5pt from each drawn edge
CASES = {
 "cornell box interior": ("artifacts/cds-corpus/cornell_2022-2023.pdf",22,(76.4,167.1,83.5,174.1)),
 "dartmouth box interior": ("artifacts/cds-corpus/dartmouth_2024-2025.pdf",21,(79.3,624.1,87.7,632.5)),
 "cornell priority blank": ("artifacts/cds-corpus/cornell_2022-2023.pdf",22,(254.4,130.0,313.1,140.8)),
 "cornell deadline blank": ("artifacts/cds-corpus/cornell_2022-2023.pdf",22,(254.4,146.5,313.1,157.2)),
 "dartmouth priority blank": ("artifacts/cds-corpus/dartmouth_2024-2025.pdf",21,(281.0,582.0,347.5,594.5)),
}
for n,(p,pi,c) in CASES.items():
    d=pymupdf.open(p); pg=d[pi]
    pix=pg.get_pixmap(dpi=900, clip=pymupdf.Rect(*c), colorspace=pymupdf.csGRAY)
    s=pix.samples
    dark=sum(1 for v in s if v<200)
    print(f"{n:28s} px={len(s):7d} dark(<200)={dark:6d} ({100*dark/len(s):.3f}%) min={min(s)}")
