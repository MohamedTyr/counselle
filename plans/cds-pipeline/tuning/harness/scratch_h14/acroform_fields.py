import pypdf

docs = {
    "uga": "artifacts/cds-corpus/uga_2023-2024.pdf",
    "caltech": "artifacts/cds-corpus/caltech_2024-2025.pdf",
}

for name, path in docs.items():
    print(f"\n\n=========== {name} ===========")
    reader = pypdf.PdfReader(path)
    fields = reader.get_fields()
    print("Total AcroForm fields (get_fields):", None if fields is None else len(fields))
    page_index = 36  # 0-based -> page 37
    page = reader.pages[page_index]
    annots = page.get("/Annots")
    if annots is not None:
        annots = annots.get_object()
    print(f"Annotations on page index {page_index} (1-based 37):", 0 if not annots else len(annots))
    if annots:
        for a in annots:
            obj = a.get_object()
            subtype = obj.get("/Subtype")
            ft = obj.get("/FT")
            name_field = obj.get("/T")
            parent = obj.get("/Parent")
            parent_name = None
            if parent is not None:
                parent_obj = parent.get_object()
                parent_name = parent_obj.get("/T")
            value = obj.get("/V")
            as_state = obj.get("/AS")
            rect = obj.get("/Rect")
            print(f"  Annot subtype={subtype} FT={ft} T={name_field!r} ParentT={parent_name!r} V={value!r} AS={as_state!r} Rect={rect}")
