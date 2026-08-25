import pymupdf
d = pymupdf.open("artifacts/cds-corpus/uga_2023-2024.pdf")
for pageno in (3, 36):
    p = d[pageno-1]
    print("="*20, "PAGE", pageno)
    for w in p.widgets():
        print(repr(w.field_name), "|type", w.field_type_string, "|value", repr(w.field_value), "|rect", [round(x,1) for x in w.rect])
