import pymupdf
S = "plans/cds-pipeline/tuning/harness/scratch_caltech_h14/"
d = pymupdf.open("artifacts/cds-corpus/caltech_2024-2025.pdf")
p = d[36]
# table approx in PDF points: full page 612x792; image 2550x3300 -> scale 4.1667
# table image x 270..1490, y 1400..2300  => pts x 65..358, y 336..552
clip = pymupdf.Rect(60, 330, 370, 560)
pix = p.get_pixmap(dpi=600, clip=clip)
pix.save(S+"caltech_h14_table_600dpi.png")
print("table", pix.width, pix.height)
# left half (non-need column) super zoom: image x 450..690 -> pts 108..166
pix = p.get_pixmap(dpi=900, clip=pymupdf.Rect(95, 336, 230, 556))
pix.save(S+"caltech_h14_nonneed_900dpi.png")
print("nonneed", pix.width, pix.height)
