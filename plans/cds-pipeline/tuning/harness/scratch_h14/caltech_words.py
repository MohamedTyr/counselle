import pymupdf

path = "artifacts/cds-corpus/caltech_2024-2025.pdf"
doc = pymupdf.open(path)
page = doc[36]

print("Optional content groups (layers):", doc.layer_ui_configs() if hasattr(doc, "layer_ui_configs") else "n/a")
try:
    print("OCGs:", doc.get_ocgs())
except Exception as e:
    print("get_ocgs error:", e)

words = page.get_text("words")
# words: x0, y0, x1, y1, text, block_no, line_no, word_no
print(f"\nTotal words: {len(words)}")
print("\nWords with box-glyph or check-glyph chars, sorted by y then x:")
target_chars = {"܆", "✔", "☐", "☑", "☒"}
box_words = [w for w in words if any(ch in target_chars for ch in w[4])]
box_words_sorted = sorted(box_words, key=lambda w: (round(w[1], 1), w[0]))
for w in box_words_sorted:
    x0, y0, x1, y1, text, *_ = w
    cps = [hex(ord(c)) for c in text]
    print(f"  y0={y0:7.2f} x0={x0:7.2f} x1={x1:7.2f} text={text!r} codepoints={cps}")

doc.close()
