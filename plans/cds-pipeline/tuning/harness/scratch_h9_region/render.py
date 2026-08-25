import pymupdf
OUT="plans/cds-pipeline/tuning/harness/scratch_h9_region/"
REG = {
 "cornell": ("artifacts/cds-corpus/cornell_2022-2023.pdf", 22, (45,112,520,195)),
 "dartmouth": ("artifacts/cds-corpus/dartmouth_2024-2025.pdf", 21, (45,560,520,652)),
 "ucf": ("artifacts/cds-corpus/ucf_2023-2024.pdf", 31, (45,440,520,550)),
}
for name,(path,pi,clip) in REG.items():
    doc=pymupdf.open(path); page=doc[pi]
    r=pymupdf.Rect(*clip)
    pix=page.get_pixmap(dpi=450, clip=r)
    pix.save(OUT+name+"_h9.png")
    print(name, "saved", pix.width, pix.height)
    print("  widgets:", len(list(page.widgets())), "annots:", len(list(page.annots())))
    print("  --- drawings intersecting region ---")
    for d in page.get_drawings():
        b=pymupdf.Rect(d["rect"])
        if b.intersects(r):
            print(f"   type={d['type']} rect=({b.x0:.1f},{b.y0:.1f},{b.x1:.1f},{b.y1:.1f}) w={b.width:.1f} h={b.height:.1f} width={d.get('width')} fill={d.get('fill')} color={d.get('color')} items={[i[0] for i in d['items']]}")
    print("  --- images intersecting region ---")
    for b in page.get_text("dict")["blocks"]:
        if b["type"]==1:
            bb=pymupdf.Rect(b["bbox"])
            if bb.intersects(r): print("   IMG", bb)
    doc.close()
