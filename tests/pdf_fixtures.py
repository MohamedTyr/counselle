"""In-process PDF builders for tests that need a real (optionally encrypted)
document rather than a checked-in binary fixture that can drift.

Lives here, shared, so the pymupdf `type: ignore`s its unannotated
compiled-extension bindings force (see `adapters/cds_pdf.py`) stay in one
place instead of once per test module.
"""

from __future__ import annotations

import pymupdf

PAGE_TEXT = "Common Data Set 2025-2026"


def build_pdf(*, user_pw: str = "", owner_pw: str = "") -> bytes:
    """A one-page PDF. With no passwords it is plain; with a `user_pw` it is
    AES-256 encrypted and unreadable without that password (PyMuPDF still
    opens it and reports its page count, then raises on any content access);
    with only an `owner_pw` it is encrypted but decrypts on open, which is how
    publishers ship a PDF that is restricted but perfectly readable.
    """
    doc = pymupdf.open()  # type: ignore[no-untyped-call]
    doc.new_page().insert_text((72, 72), PAGE_TEXT)
    if not user_pw and not owner_pw:
        return bytes(doc.tobytes())  # type: ignore[no-untyped-call]
    return bytes(
        doc.tobytes(  # type: ignore[no-untyped-call]
            encryption=pymupdf.PDF_ENCRYPT_AES_256,  # type: ignore[attr-defined]
            user_pw=user_pw,
            owner_pw=owner_pw,
            permissions=pymupdf.PDF_PERM_ACCESSIBILITY,  # type: ignore[attr-defined]
        )
    )
