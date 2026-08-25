import pymupdf
S = "plans/cds-pipeline/tuning/harness/scratch_caltech_h14/"
u = pymupdf.open("artifacts/cds-corpus/uga_2023-2024.pdf")[36]
c = pymupdf.open("artifacts/cds-corpus/caltech_2024-2025.pdf")[36]
sx, sy = 612/1546.0, 792/2000.0
# UGA non-need column strip
clip = pymupdf.Rect(440*sx, 850*sy, 700*sx, 1430*sy)
u.get_pixmap(dpi=1200, clip=clip).save(S+"u_h14_nonneed_1200.png")
print("uga widgets p37:", len(list(u.widgets())))
for w in list(u.widgets())[:6]:
    print("  ", w.field_type_string, repr(w.field_name), repr(w.field_value), w.rect)
print("caltech widgets p37:", len(list(c.widgets())))
# Single-row zoom: Academics row, both columns, both docs
row = pymupdf.Rect(440*sx, 912*sy, 910*sx, 955*sy)
c.get_pixmap(dpi=1600, clip=row).save(S+"c_row_academics_1600.png")
u.get_pixmap(dpi=1600, clip=row).save(S+"u_row_academics_1600.png")
# Caltech: single empty non-need box super zoom (Alumni row)
box = pymupdf.Rect(540*sx, 958*sy, 590*sx, 1000*sy)
c.get_pixmap(dpi=2400, clip=box).save(S+"c_box_alumni_nonneed_2400.png")
