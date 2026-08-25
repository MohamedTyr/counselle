import pymupdf
S = "plans/cds-pipeline/tuning/harness/scratch_caltech_h14/"
for name, path, page in [("caltech", "artifacts/cds-corpus/caltech_2024-2025.pdf", 36),
                         ("uga", "artifacts/cds-corpus/uga_2023-2024.pdf", 36)]:
    d = pymupdf.open(path)
    print(name, "pages:", d.page_count)
    p = d[page]
    print(" rect:", p.rect)
    pix = p.get_pixmap(dpi=300)
    pix.save(f"{S}{name}_p37_full.png")
    print(" saved", pix.width, pix.height)
    ws = p.widgets()
    n = 0
    for w in ws:
        n += 1
        if n <= 80:
            print("  widget:", w.field_type_string, repr(w.field_name), repr(w.field_value), w.rect)
    print(" total widgets:", n)
