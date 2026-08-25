import pymupdf
c = pymupdf.open("artifacts/cds-corpus/caltech_2024-2025.pdf")[36]
rows = [("Academics",364.7),("Alumni affiliation",382.6),("Art",401.8),("Athletics",420.3),
        ("Job skills",438.7),("ROTC",458.0),("Leadership",475.6),("Music/drama",494.6),
        ("Religious affiliation",513.3),("State/district residency",531.6)]
cols = [("NonNeed",218.3),("NeedBased",308.3)]
Z=8  # zoom factor
for rname,y in rows:
    line=[]
    for cname,x in cols:
        # interior only: inset 2.5pt from the 9.5pt box edge
        r = pymupdf.Rect(x+2.5, y+2.5, x+7.5, y+7.5)
        pix = c.get_pixmap(matrix=pymupdf.Matrix(Z,Z), clip=r, colorspace=pymupdf.csGRAY)
        px = pix.samples
        dark = sum(1 for b in px if b < 140)
        line.append(f"{cname}: dark_px={dark}/{len(px)} min={min(px)}")
    print(f"{rname:26s} " + " | ".join(line))
