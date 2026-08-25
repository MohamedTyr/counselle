import pymupdf

docs = {
    "uga": "artifacts/cds-corpus/uga_2023-2024.pdf",
    "caltech": "artifacts/cds-corpus/caltech_2024-2025.pdf",
}
PAGE_INDEX = 36
OUT = "plans/cds-pipeline/tuning/harness/scratch_h14"

# PDF-space crop box (points), generous around the H14 grid
crop = pymupdf.Rect(30, 300, 400, 590)

for name, path in docs.items():
    doc = pymupdf.open(path)
    page = doc[PAGE_INDEX]
    for dpi in (150, 300):
        zoom = dpi / 72.0
        mat = pymupdf.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, clip=crop)
        out_path = f"{OUT}/{name}_h14_crop_{dpi}dpi.png"
        pix.save(out_path)
        print(f"saved {out_path} size={pix.width}x{pix.height}")
    doc.close()
