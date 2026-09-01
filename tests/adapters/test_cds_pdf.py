"""Regression tests for `adapters/cds_pdf.py`'s failure contract: every entry
point either succeeds or raises this module's own `CdsPdfError`.

`_open` used to wrap `pymupdf.open()` and nothing else, which is not where
PyMuPDF actually fails on a password-protected document. It opens one happily
and even reports a correct `page_count`; the bare
`ValueError("document closed or encrypted")` arrives on the first call that
touches *content* -- `get_text`, `insert_pdf`, `bake`, `get_pixmap`. That
sailed past every caller's `except cds_pdf.CdsPdfError` and reached the global
handler as a 500, so an admin uploading an encrypted PDF got a failed request
with no upload row written at all instead of the per-file `error` status
`app/cds/service_ingest.py` is built around.

The PDFs here are built in-process rather than checked in, so the encryption
they use is real and the test cannot drift from a stale fixture.
"""

from __future__ import annotations

import pytest

from adapters import cds_pdf
from tests.pdf_fixtures import build_pdf as _pdf


class TestEncryptedPdfFailsAsCdsPdfError:
    async def test_page_count_refuses_a_password_protected_document(self) -> None:
        """The first call every ingest path makes. Failing here is what gets
        the admin an `error` upload row instead of a 500 three calls later."""
        with pytest.raises(cds_pdf.CdsPdfError) as excinfo:
            await cds_pdf.get_page_count(_pdf(user_pw="secret", owner_pw="owner"))
        assert "password-protected or unreadable PDF" in str(excinfo.value)

    @pytest.mark.parametrize("call", ["narrow", "routing_text", "render", "corrupt", "form"])
    async def test_every_content_touching_entry_point_raises_cds_pdf_error(
        self, call: str
    ) -> None:
        """`narrow_document` is the one `detect.detect_school_year` hits, but
        the raw `ValueError` was reachable from all of them."""
        pdf_bytes = _pdf(user_pw="secret", owner_pw="owner")
        with pytest.raises(cds_pdf.CdsPdfError):
            if call == "narrow":
                await cds_pdf.narrow_document(pdf_bytes, [1])
            elif call == "routing_text":
                await cds_pdf.extract_routing_text(pdf_bytes)
            elif call == "render":
                await cds_pdf.render_page_png(pdf_bytes, 1)
            elif call == "corrupt":
                await cds_pdf.detect_corrupt_text_layer(pdf_bytes)
            else:
                await cds_pdf.has_form_fields(pdf_bytes)

    async def test_sanity_check_reports_false_rather_than_raising(self) -> None:
        """Its documented contract is a boolean verdict, and it already
        swallows `CdsPdfError` into `False` -- an unreadable document is
        legitimately "not a readable CDS PDF"."""
        assert await cds_pdf.sanity_check_cds_pdf(_pdf(user_pw="secret", owner_pw="owner")) is False


class TestReadablePdfsAreUnaffected:
    async def test_a_plain_pdf_still_reads_normally(self) -> None:
        pdf_bytes = _pdf()
        assert await cds_pdf.get_page_count(pdf_bytes) == 1
        assert "Common Data Set" in (await cds_pdf.extract_routing_text(pdf_bytes))[1]
        assert await cds_pdf.sanity_check_cds_pdf(pdf_bytes) is True

    async def test_an_owner_password_only_pdf_is_still_read(self) -> None:
        """Encrypted, but with an empty *user* password, so it decrypts on open
        and every content call works. Publishers ship CDS PDFs like this to
        restrict printing; refusing them would reject documents the pipeline
        has always been able to read."""
        pdf_bytes = _pdf(owner_pw="owner")
        assert await cds_pdf.get_page_count(pdf_bytes) == 1
        assert "Common Data Set" in (await cds_pdf.extract_routing_text(pdf_bytes))[1]

    async def test_an_out_of_range_page_keeps_its_own_error_type(self) -> None:
        """`CdsPdfPageRangeError` is caught separately by the page-image route
        to answer 404 instead of 500; flattening it into the base class would
        silently change that."""
        with pytest.raises(cds_pdf.CdsPdfPageRangeError):
            await cds_pdf.render_page_png(_pdf(), 99)
