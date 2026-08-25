import pypdf
r = pypdf.PdfReader("artifacts/cds-corpus/uga_2023-2024.pdf")
p = r.pages[36]
txt = p.extract_text()
i = txt.find("H14")
print(txt[i-200:i+1400] if i>=0 else txt[:2000])
print("=== WIDGETS ON PAGE 37 ===")
for a in p.get("/Annots", []):
    o = a.get_object()
    nm = o.get("/T") or (o.get("/Parent") and o["/Parent"].get_object().get("/T"))
    print(nm, "V=", o.get("/V"), "AS=", o.get("/AS"), "rect=", [round(float(x)) for x in o.get("/Rect",[])])
