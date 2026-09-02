"""Tests for `app/cds/calling.py`'s page-mapping wiring on the images-only
(form-marks) call path -- plan finding E-01.

`_run_call_once` builds a narrowed-window `page_map` from the padded routing
window BEFORE `_call_evidence` runs, then used to pass it to `_build_prompt`
unconditionally -- even when `_call_evidence` had just set `call_bytes = None`
(the AcroForm form-marks path, `routing.py`'s `_form_mark_pages`/
`_c7_supplementary_images`: no PDF is sent at all, only PNGs of the pages
those helpers independently routed). The prompt then described a page mapping
for a document that was never sent, so a "position N" citation could resolve
through the wrong map to a real-but-unseen page instead of being dropped.

This is the one integration point no other test module covers: `_form_mark_
pages`/`_c7_supplementary_images` are unit-tested in isolation
(`test_engine.py`), but nothing previously exercised the combined prompt/
page_map wiring for the case where `_call_evidence` nulls `call_bytes`.
"""

from __future__ import annotations

from typing import Any

import pymupdf
import pytest

from adapters import cds_gemini, cds_pdf
from app.cds.calling import _run_call_once
from domain.cds.claims import WindowExtraction

# A padded routing window (38-44) that is WIDER than, and offset from, the
# form-mark pages actually routed and sent as images (40-43) -- the exact
# AcroForm/UGA scenario E-01 describes: `page_map` positions 1-7 would map
# to pages 38-44, but only pages 40-43 are ever rendered and sent.
_DOC_PAGE_COUNT = 50
_PADDED_CLUSTER = ((38, 44),)
_ROUTING_TEXT = {
    40: "H1 heading",
    41: "H1 continued",
    42: "H1 continued",
    43: "H1 continued",
}
_BATCH_METRICS = ({"type": "boolean", "source_hints": ["H1"]},)


def _make_pdf(page_count: int) -> bytes:
    document = pymupdf.open()
    try:
        for index in range(page_count):
            page = document.new_page()
            page.insert_text((72, 72), f"page {index + 1} content")
        return document.tobytes()
    finally:
        document.close()


async def test_form_marks_prompt_describes_the_images_actually_sent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When `_call_evidence` nulls `call_bytes` (form-marks path), the
    prompt's page-numbering note must map position N to the pages rendered
    and sent as images, never to the (now-unsent) narrowed `page_map` built
    from the padded routing window."""
    captured: dict[str, Any] = {}

    async def _has_form_fields(pdf_bytes: bytes) -> bool:
        return True

    async def _fake_generate_structured(
        *,
        settings: object,
        prompt: str,
        response_schema: type,
        pdf_bytes: bytes | None,
        image_pngs: tuple[bytes, ...],
        model_setting: str,
        thinking_budget: int,
        thinking_level: str | None,
    ) -> cds_gemini.GenerateResult:
        captured["prompt"] = prompt
        captured["pdf_bytes"] = pdf_bytes
        captured["image_count"] = len(image_pngs)
        return cds_gemini.GenerateResult(
            parsed=WindowExtraction(findings=[]),
            usage=cds_gemini.Usage(
                prompt_tokens=1, output_tokens=1, thoughts_tokens=0,
                cached_tokens=0, total_tokens=2,
            ),
            latency_seconds=0.01,
            model_id="fake-model",
            finish_reason="STOP",
        )

    monkeypatch.setattr(cds_pdf, "has_form_fields", _has_form_fields)
    monkeypatch.setattr(cds_gemini, "generate_structured", _fake_generate_structured)

    from types import SimpleNamespace

    await _run_call_once(
        settings=SimpleNamespace(
            model_cds_extract="google-vertex:fake-model",
            model_cds_extract_thinking_budget=0,
            model_cds_extract_deliberation_budget=0,
            model_cds_extract_deliberation_level="",
        ),
        manifest_content={"prompt": "extract"},
        pdf_content=_make_pdf(_DOC_PAGE_COUNT),
        original_page_count=_DOC_PAGE_COUNT,
        routing_text=_ROUTING_TEXT,
        batch_metrics=_BATCH_METRICS,
        clusters=_PADDED_CLUSTER,
        page_text=None,
    )

    # Images-only call: the misleading text-bearing PDF must be withheld.
    assert captured["pdf_bytes"] is None
    assert captured["image_count"] == 4

    prompt = captured["prompt"]
    # The mapping must describe the images actually sent (pages 40-43)...
    assert "position 1 = original page 40" in prompt
    assert "position 4 = original page 43" in prompt
    # ...never the stale, wider, offset padded-window mapping (pages 38-44)
    # that would have been used before this fix, since no PDF built from
    # that window was ever sent.
    assert "original page 38" not in prompt
    assert "original page 44" not in prompt
