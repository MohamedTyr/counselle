import pymupdf
c = pymupdf.open("artifacts/cds-corpus/caltech_2024-2025.pdf")[36]
u = pymupdf.open("artifacts/cds-corpus/uga_2023-2024.pdf")[36]
def boxes(p, name):
    out=[]
    for d in p.get_drawings():
        r=d["rect"]
        if 6 < r.width < 14 and 6 < r.height < 14 and r.y0 > 330 and r.y1 < 560:
            out.append((round(r.x0,1), round(r.y0,1), round(r.width,1), round(r.height,1), d["type"], d.get("color"), d.get("width")))
    out.sort(key=lambda t:(t[1],t[0]))
    print(f"== {name}: {len(out)} small square paths in H14 band")
    for o in out: print("  ", o)
boxes(c,"CALTECH")
boxes(u,"UGA (vector layer only; widgets drawn separately)")
