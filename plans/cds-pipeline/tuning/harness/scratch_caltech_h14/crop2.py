import pymupdf
S = "plans/cds-pipeline/tuning/harness/scratch_caltech_h14/"
d = pymupdf.open("artifacts/cds-corpus/caltech_2024-2025.pdf")
p = d[36]
print("page rect", p.rect)
# full page is 612x792 pt presumably. H14 table in full render spans y approx 860/2000*792
# from the 300dpi image (2550x3300): table box x 165..900, y 860..1375 in the 1546x2000 displayed => *1.65
# convert to points: displayed 1546 wide == 612 pt  => scale 612/1546 = 0.3958
sx = p.rect.width/1546.0
sy = p.rect.height/2000.0
clip = pymupdf.Rect(150*sx, 850*sy, 920*sx, 1390*sy)
print("clip", clip)
pix = p.get_pixmap(dpi=900, clip=clip)
pix.save(S+"c_h14_full_900.png")
print(pix.width, pix.height)
# non-need column only: x 450..690 displayed
clip2 = pymupdf.Rect(440*sx, 850*sy, 700*sx, 1390*sy)
pix2 = p.get_pixmap(dpi=1200, clip=clip2)
pix2.save(S+"c_h14_nonneed_1200.png")
print(pix2.width, pix2.height)
# need-based col
clip3 = pymupdf.Rect(680*sx, 850*sy, 910*sx, 1390*sy)
pix3 = p.get_pixmap(dpi=1200, clip=clip3)
pix3.save(S+"c_h14_needbased_1200.png")
print(pix3.width, pix3.height)
print("widgets:", len(list(p.widgets())))
print("drawings:", len(p.get_drawings()))
