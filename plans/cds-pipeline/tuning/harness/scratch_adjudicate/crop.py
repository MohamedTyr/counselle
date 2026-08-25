import pymupdf, sys
path, pageno, x0,y0,x1,y1, out = sys.argv[1], int(sys.argv[2]), *map(float, sys.argv[3:7]), sys.argv[7]
d = pymupdf.open(path)
p = d[pageno-1]
pix = p.get_pixmap(dpi=300, clip=pymupdf.Rect(x0,y0,x1,y1))
pix.save(out)
print(out, pix.width, pix.height)
