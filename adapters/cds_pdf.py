"""PyMuPDF I/O for the CDS admin pipeline (PLAN §B1 `adapters/cds_pdf.py`).

All PyMuPDF (``fitz``/``pymupdf``) work is CPU-bound and synchronous; every
public function here is ``async`` and offloads the real work via
``asyncio.to_thread`` (PLAN Risk 7) so it never blocks the event loop that
chat traffic shares.

Text extracted here is **routing hints only** — see ``extract_routing_text``.
The corpus recon (``specs/cds-pipeline/plan/recon/recon-cds-corpus.md``) proves
PyMuPDF's text layer can be silently, plausibly wrong on real CDS PDFs
(Caltech's broken ToUnicode CMaps shift digits/letters with no exception
raised). Nothing downstream may treat this text as ground truth — an
extraction claim must come from a model call over the actual PDF/image
bytes. ``detect_corrupt_text_layer`` is the mitigation: a heuristic that
flags a document so the engine forces the vision path and raises a review
flag instead of trusting corrupted text silently.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Sequence
from dataclasses import dataclass

import pymupdf

DEFAULT_RENDER_DPI = 150
# CDS PDFs are single-digit-MB / <200 pages (recon-cds-corpus.md §1); a
# document with zero pages isn't a document at all.
_MIN_PLAUSIBLE_PAGE_COUNT = 1

# Calibrated against the 15-file corpus (see the P2 verification script):
# every one of Caltech's 50 pages carries >=2 control characters (1,772
# total); the only other hit anywhere in the corpus is a single isolated
# stray control byte on one UCF page (a checkmark-glyph artifact, not a
# broken CMap). >=2 per page cleanly separates the two; >=3 affected pages
# before flagging the whole document keeps one stray page from being noise.
_PAGE_CONTROL_CHAR_THRESHOLD = 2
_DOCUMENT_AFFECTED_PAGE_THRESHOLD = 3
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

# sub-PDF 1-indexed page number -> ORIGINAL document 1-indexed physical page
# number. Cited pages must always be real physical pages, never narrowed
# indices (PLAN §B4).
PageMap = dict[int, int]


class CdsPdfError(Exception):
    """Base for CDS PDF adapter failures — never swallowed silently."""


class CdsPdfPageRangeError(CdsPdfError):
    """A requested page number is out of range for the document."""


@dataclass(frozen=True)
class CorruptTextReport:
    """Result of the broken-ToUnicode-CMap corruption heuristic (recon §7)."""

    is_corrupt: bool
    control_char_count: int
    total_char_count: int
    affected_pages: tuple[int, ...]  # 1-indexed physical page numbers


def _open(pdf_bytes: bytes) -> pymupdf.Document:
    # pymupdf ships a `py.typed` marker but its compiled-extension bindings
    # are not fully annotated, so mypy sees these as untyped calls returning
    # Any (no-untyped-call / no-any-return) — expected, not a real issue.
    try:
        return pymupdf.open(stream=pdf_bytes, filetype="pdf")  # type: ignore[no-untyped-call]
    except Exception as exc:  # pymupdf raises assorted RuntimeError/ValueError variants
        raise CdsPdfError(f"could not open PDF: {exc}") from exc


def _require_valid_page(page_number: int, page_count: int) -> None:
    if not 1 <= page_number <= page_count:
        raise CdsPdfPageRangeError(
            f"page {page_number} out of range (document has {page_count} pages)"
        )


def _get_page_count_sync(pdf_bytes: bytes) -> int:
    with _open(pdf_bytes) as doc:
        return doc.page_count  # type: ignore[no-any-return]


async def get_page_count(pdf_bytes: bytes) -> int:
    """Physical page count of the document."""
    return await asyncio.to_thread(_get_page_count_sync, pdf_bytes)


def _get_metadata_sync(pdf_bytes: bytes) -> dict[str, str]:
    with _open(pdf_bytes) as doc:
        return {str(key): str(value) for key, value in doc.metadata.items() if value}


async def get_metadata(pdf_bytes: bytes) -> dict[str, str]:
    """PDF producer/creator/title metadata.

    A **soft routing hint only** — recon-cds-corpus.md §6 shows an
    Excel-producer PDF can extract perfectly (Reed) while an
    Adobe-Distiller PDF can be silently corrupted (Caltech). Never gate
    extraction strategy on this alone.
    """
    return await asyncio.to_thread(_get_metadata_sync, pdf_bytes)


def _sanity_check_sync(pdf_bytes: bytes) -> bool:
    try:
        with _open(pdf_bytes) as doc:
            if doc.page_count < _MIN_PLAUSIBLE_PAGE_COUNT:
                return False
            first_page_text = doc[0].get_text("text")
            return "common data set" in first_page_text.casefold()
    except CdsPdfError:
        return False


async def sanity_check_cds_pdf(pdf_bytes: bytes) -> bool:
    """Cheap "is this even a CDS PDF" check: opens, has >=1 page, and page 1
    mentions "Common Data Set" (every one of the 15 corpus files does —
    recon-cds-corpus.md §3). A fast reject for an obviously-wrong upload,
    never a hard gate on a real one downstream.
    """
    return await asyncio.to_thread(_sanity_check_sync, pdf_bytes)


def _render_page_png_sync(pdf_bytes: bytes, page_number: int, dpi: int) -> bytes:
    with _open(pdf_bytes) as doc:
        _require_valid_page(page_number, doc.page_count)
        pixmap = doc[page_number - 1].get_pixmap(dpi=dpi)
        return pixmap.tobytes("png")  # type: ignore[no-any-return]


async def render_page_png(
    pdf_bytes: bytes, page_number: int, *, dpi: int = DEFAULT_RENDER_DPI
) -> bytes:
    """Render one 1-indexed physical page to PNG bytes.

    Used by both the review screen's page viewer (D#10) and the C7
    checkbox-grid vision fallback — a third of the corpus has no textual
    mark for C7 at all (recon-cds-corpus.md §4c).
    """
    return await asyncio.to_thread(_render_page_png_sync, pdf_bytes, page_number, dpi)


def _narrow_document_sync(pdf_bytes: bytes, page_numbers: Sequence[int]) -> tuple[bytes, PageMap]:
    if not page_numbers:
        raise CdsPdfError("narrow_document requires at least one page number")
    with _open(pdf_bytes) as doc:
        for page_number in page_numbers:
            _require_valid_page(page_number, doc.page_count)
    with _open(pdf_bytes) as doc:
        # Bake interactive form fields into page content BEFORE slicing.
        # `insert_pdf` copies page content but leaves the document-level
        # AcroForm behind, so on a form PDF every field silently loses its
        # value: UGA's narrowed pages come back with empty checkbox glyphs and
        # blank answer boxes, and the model then truthfully reports
        # `not_reported` for nearly everything it is asked. That is silent data
        # destruction -- a plausible empty answer rather than an error -- and it
        # cost UGA 326 of its 350 findings. Baking turns the field appearances
        # into ordinary page content, which slicing does preserve.
        #
        # `select()` also preserves them, but keeps the whole source resource
        # tree: a 5-page UGA slice measured 3.05MB against a 2.03MB source,
        # versus 539KB baked. Baking is the cheap way to be correct.
        if doc.is_form_pdf:
            doc.bake()

        sub = pymupdf.open()  # type: ignore[no-untyped-call]
        try:
            page_map: PageMap = {}
            for sub_index, original_page_number in enumerate(page_numbers, start=1):
                sub.insert_pdf(  # type: ignore[no-untyped-call]
                    doc, from_page=original_page_number - 1, to_page=original_page_number - 1
                )
                page_map[sub_index] = original_page_number
            # Write compressed. PyMuPDF's default `tobytes()` emits an
            # UNCOMPRESSED document, and the per-page copies duplicate shared
            # image streams -- which is how a "narrowed" slice of an
            # image-heavy scan came out LARGER than the document it was cut
            # from (Caltech: 3.96MB from a 2.14MB source) and blew the model
            # call's write deadline. `garbage=4` deduplicates those streams.
            # Do NOT add `clean=True`: it rewrites content streams.
            narrowed = sub.tobytes(deflate=True, garbage=4)  # type: ignore[no-untyped-call]
        finally:
            sub.close()  # type: ignore[no-untyped-call]

    # A slice larger than its own source is strictly worse on every axis --
    # more upload bytes, more timeout risk, and no less for the model to read.
    if len(narrowed) >= len(pdf_bytes):
        with _open(pdf_bytes) as doc:
            return pdf_bytes, {page: page for page in range(1, doc.page_count + 1)}
    return narrowed, page_map


async def narrow_document(pdf_bytes: bytes, page_numbers: Sequence[int]) -> tuple[bytes, PageMap]:
    """Build a sub-PDF from an ordered list of ORIGINAL 1-indexed physical
    page numbers and return it with the mapping back to those page numbers.

    Physical page numbers a model cites against the narrowed sub-PDF must
    always be translated through the returned ``PageMap`` before they touch
    a packet — a narrowed sub-PDF's own page indices must never leak into
    stored evidence (PLAN §B4).
    """
    return await asyncio.to_thread(_narrow_document_sync, pdf_bytes, list(page_numbers))


def _extract_routing_text_sync(
    pdf_bytes: bytes, page_numbers: Sequence[int] | None
) -> dict[int, str]:
    with _open(pdf_bytes) as doc:
        pages = page_numbers if page_numbers is not None else range(1, doc.page_count + 1)
        result: dict[int, str] = {}
        for page_number in pages:
            _require_valid_page(page_number, doc.page_count)
            result[page_number] = doc[page_number - 1].get_text("text")
        return result


async def extract_routing_text(
    pdf_bytes: bytes, page_numbers: Sequence[int] | None = None
) -> dict[int, str]:
    """Plain-text extraction, **routing hints only** — never a source of truth.

    Named to make the contract impossible to miss at the call site: the
    corpus recon proves this text can be silently, plausibly wrong. Use this
    only to decide where to look (section detection, page routing). Every
    claim a packet stores must come from a model call over actual PDF/image
    bytes, and any page whose text trips ``detect_corrupt_text_layer`` must
    be routed to the vision path instead of trusted here.
    """
    return await asyncio.to_thread(_extract_routing_text_sync, pdf_bytes, page_numbers)


def _detect_corrupt_text_layer_sync(pdf_bytes: bytes) -> CorruptTextReport:
    with _open(pdf_bytes) as doc:
        total_chars = 0
        control_chars = 0
        affected_pages: list[int] = []
        for index in range(doc.page_count):
            text = doc[index].get_text("text")
            total_chars += len(text)
            page_control = len(_CONTROL_CHAR_RE.findall(text))
            control_chars += page_control
            if page_control >= _PAGE_CONTROL_CHAR_THRESHOLD:
                affected_pages.append(index + 1)
        return CorruptTextReport(
            is_corrupt=len(affected_pages) >= _DOCUMENT_AFFECTED_PAGE_THRESHOLD,
            control_char_count=control_chars,
            total_char_count=total_chars,
            affected_pages=tuple(affected_pages),
        )


async def detect_corrupt_text_layer(pdf_bytes: bytes) -> CorruptTextReport:
    """Heuristic for silently broken ToUnicode CMaps (recon-cds-corpus.md
    §7): a subset of a document's embedded fonts can remap digits/letters to
    control-range code points with no exception raised and no empty-string
    signal — a naive extraction pass returns plausible-looking, factually
    wrong text (e.g. "2024-2025" -> "202\\x17-202\\x18").

    A page counts as affected once it carries at least
    ``_PAGE_CONTROL_CHAR_THRESHOLD`` control characters (0x00-0x1F excluding
    ``\\t\\n\\r``); the whole document is flagged once at least
    ``_DOCUMENT_AFFECTED_PAGE_THRESHOLD`` pages are affected. The engine
    should force the vision path and raise a review flag whenever this
    fires. Calibrated numbers are in the P2 verification report.
    """
    return await asyncio.to_thread(_detect_corrupt_text_layer_sync, pdf_bytes)


def _has_form_fields_sync(pdf_bytes: bytes) -> bool:
    with _open(pdf_bytes) as doc:
        return bool(doc.is_form_pdf)


async def has_form_fields(pdf_bytes: bytes) -> bool:
    """True when the source is an AcroForm PDF, i.e. its answers live in
    interactive widgets whose ticks render but never reach the text layer."""
    return await asyncio.to_thread(_has_form_fields_sync, pdf_bytes)
