import pymupdf

docs = {
    "uga_2023-2024": "artifacts/cds-corpus/uga_2023-2024.pdf",
    "caltech_2024-2025": "artifacts/cds-corpus/caltech_2024-2025.pdf",
}

PAGE_INDEX = 36  # 0-based, = 1-based page 37

for name, path in docs.items():
    doc = pymupdf.open(path)
    page = doc[PAGE_INDEX]
    text = page.get_text()
    print(f"\n\n================ {name} page index {PAGE_INDEX} (1-based 37) RAW TEXT ================")
    print(text)
    print(f"---- codepoints for non-ascii / symbol-ish chars in this text ----")
    seen = {}
    for ch in text:
        cp = ord(ch)
        if cp > 127 or ch in "☐☑☒Xx□■":
            seen[ch] = seen.get(ch, 0) + 1
    for ch, count in sorted(seen.items(), key=lambda kv: -kv[1]):
        try:
            name_u = __import__("unicodedata").name(ch)
        except Exception:
            name_u = "<no name>"
        print(f"  U+{ord(ch):04X} ({name_u}) x{count}  repr={ch!r}")
    doc.close()
