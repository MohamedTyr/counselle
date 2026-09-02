"""Multi-batch citation-remap isolation tests for `app/cds/batch_run.py` +
`app/cds/engine.py`'s `_run_call`/`_run_call_once` wiring.

Regression coverage for the page-citation offset defect diagnosed in
`specs/cds-pipeline/plan/routing-tuning.md` §9: several batches (possibly
different domains) running concurrently, EACH with its own narrowed page
window, must each resolve their own citations against their OWN `PageMap` --
never a different batch's. `citation_remap.py`/`domain/cds/pages.py` are
already unit-tested in isolation (`test_citation_remap.py`, `test_pages.py`);
this file is the one that would have caught a wiring bug where the wrong
batch's window got attached to the wrong batch's findings, since that bug
class can only surface once the full `narrow_document -> generate ->
remap_findings` pipeline runs for real, concurrently, across more than one
window -- exactly what `batch_run.run_batches`'s bounded-concurrency
`asyncio.gather` does in production.

Uses a real in-memory PDF (not a mock) so `narrow_document`'s actual
PyMuPDF page math is exercised, with only the model call
(`adapters.cds_gemini.generate_structured`) faked.
"""

from __future__ import annotations

from types import SimpleNamespace

import pymupdf
import pytest

from adapters import cds_gemini, cds_store
from app.cds import batch_run
from app.cds.batching import Batch
from app.cds.calling import DomainOutcome
from domain.cds.claims import Finding, WindowExtraction

# Two widely-separated windows in a 30-page document -- if a batch's
# findings were ever remapped through a DIFFERENT batch's `PageMap`, this
# gap makes the mistake impossible to miss (page 2 vs page 24, not an
# off-by-one that could be confused with a legitimate adjacent-page result).
_DOC_PAGE_COUNT = 30
_WINDOW_A = (2, 4)  # domain_a's padded routing window (original pages 2-4)
_WINDOW_B = (24, 26)  # domain_b's padded routing window (original pages 24-26)


def _make_pdf(page_count: int) -> bytes:
    document = pymupdf.open()
    try:
        for index in range(page_count):
            page = document.new_page()
            page.insert_text((72, 72), f"page {index + 1} content")
        return document.tobytes()
    finally:
        document.close()


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
    """Stands in for the model: always cites POSITION 1 (the first page of
    WHATEVER window this call was actually sent) -- distinguishing which
    domain's batch this call belongs to from its own prompt, never from any
    shared/external state, so the fake cannot itself leak information across
    batches the way a real wiring bug would."""
    metric_id = "domain_a.metric_one" if "domain_a" in prompt else "domain_b.metric_one"
    finding = Finding(
        metric_id=metric_id,
        availability_status="reported",
        value="x",
        raw_value="x",
        page_number=1,
        excerpt="page content",
    )
    return cds_gemini.GenerateResult(
        parsed=WindowExtraction(findings=[finding]),
        usage=cds_gemini.Usage(
            prompt_tokens=10, output_tokens=10, thoughts_tokens=0, cached_tokens=0, total_tokens=20
        ),
        latency_seconds=0.01,
        model_id="fake-model",
        finish_reason="STOP",
    )


async def test_concurrent_batches_each_resolve_citations_against_their_own_page_map(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The core regression case: two batches (different domains, different
    narrowed windows) run under `batch_run.run_batches`'s real bounded
    concurrency. Both findings cite "position 1" -- only correct if each
    call's remap used THAT call's own window, since position 1 means a
    different original page in each window."""
    monkeypatch.setattr(cds_gemini, "generate_structured", _fake_generate_structured)

    batches = [
        Batch("domain_a", 0, ({"id": "domain_a.metric_one", "source_hints": ["ZZ"]},), frozenset()),
        Batch("domain_b", 0, ({"id": "domain_b.metric_one", "source_hints": ["ZZ"]},), frozenset()),
    ]
    padded_ranges = {"domain_a#0": _WINDOW_A, "domain_b#0": _WINDOW_B}

    results = await batch_run.run_batches(
        batches,
        lease_lost=None,
        settings=SimpleNamespace(
            model_cds_extract="google-vertex:fake-model",
            model_cds_extract_thinking_budget=0,
            model_cds_extract_deliberation_budget=0,
            model_cds_extract_deliberation_level="",
        ),
        manifest_content={"prompt": "extract"},
        pdf_content=_make_pdf(_DOC_PAGE_COUNT),
        original_page_count=_DOC_PAGE_COUNT,
        routing_text={},
        padded_ranges=padded_ranges,
        page_text=None,
    )

    by_domain = {batch.domain_id: (call_result, error) for batch, call_result, error in results}

    a_result, a_error = by_domain["domain_a"]
    b_result, b_error = by_domain["domain_b"]
    assert a_error is None and a_result is not None
    assert b_error is None and b_result is not None

    assert [f.page_number for f in a_result.findings] == [_WINDOW_A[0]]
    assert [f.page_number for f in b_result.findings] == [_WINDOW_B[0]]
    # The failure mode this test exists to catch: domain_a's citation
    # resolved against domain_b's window (or vice versa) would silently
    # produce the OTHER domain's page instead of raising -- so a plain
    # equality assertion above is necessary but this makes the intent
    # explicit for anyone reading a future regression's diff.
    assert a_result.findings[0].page_number != b_result.findings[0].page_number


async def test_many_batches_stress_concurrency_bound_without_cross_contamination(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`_MAX_CONCURRENT_BATCH_CALLS = 6` -- more than 6 batches forces at
    least two waves through the semaphore. Every batch still gets its own
    distinct window's first page back, not a neighbor's, across both waves."""
    monkeypatch.setattr(cds_gemini, "generate_structured", _fake_generate_structured)
    doc_page_count = 90
    # 8 non-overlapping 3-page windows spread across the document -- more
    # than the concurrency bound of 6, so this exercises a second wave.
    windows = [(3 * i + 2, 3 * i + 4) for i in range(8)]
    batches = [
        Batch(
            f"domain_a_{i}" if i % 2 == 0 else f"domain_b_{i}",
            0,
            ({"id": f"domain_a.metric_{i}" if i % 2 == 0 else f"domain_b.metric_{i}",
              "source_hints": ["ZZ"]},),
            frozenset(),
        )
        for i in range(8)
    ]
    padded_ranges = {batch.key: window for batch, window in zip(batches, windows, strict=True)}

    results = await batch_run.run_batches(
        batches,
        lease_lost=None,
        settings=SimpleNamespace(
            model_cds_extract="google-vertex:fake-model",
            model_cds_extract_thinking_budget=0,
            model_cds_extract_deliberation_budget=0,
            model_cds_extract_deliberation_level="",
        ),
        manifest_content={"prompt": "extract"},
        pdf_content=_make_pdf(doc_page_count),
        original_page_count=doc_page_count,
        routing_text={},
        padded_ranges=padded_ranges,
        page_text=None,
    )

    for batch, call_result, error in results:
        assert error is None and call_result is not None
        expected_first_page = padded_ranges[batch.key][0]
        assert [f.page_number for f in call_result.findings] == [expected_first_page], (
            f"batch {batch.key} resolved its position-1 citation to the wrong original page "
            "-- cross-batch PageMap contamination"
        )


async def test_store_domain_packets_isolates_one_domains_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plan finding Z-01: a DB error (or any other exception) building/storing
    ONE domain's packet must not abort the whole loop -- it must be reported
    as that domain's own failed `DomainOutcome`, mirroring the existing
    `PacketValidationError` handling in `calling._store_packet`, while every
    OTHER domain's outcome still lands. Before this fix, an exception escaping
    `_build_and_store_domain_packet` unwound the whole loop: an 11/13-domain
    partial success got recorded as a total `failed` extraction with no
    `validation_summary` at all, even though 11 domains' packets were already
    durably committed in their own transactions."""
    seen_domains: list[str] = []

    async def _fake_build_and_store(*, domain_id: str, **_kwargs: object) -> DomainOutcome:
        seen_domains.append(domain_id)
        if domain_id == "domain_b":
            raise RuntimeError("transient db error")
        return DomainOutcome(domain_id, "succeeded", {"verified": 1}, 0, None)

    monkeypatch.setattr(batch_run, "_build_and_store_domain_packet", _fake_build_and_store)

    requested_domains = ["domain_a", "domain_b", "domain_c"]
    outcomes = await batch_run.store_domain_packets(
        pool=None,
        settings=None,
        manifest=None,  # type: ignore[arg-type]
        requested_domains=requested_domains,
        domain_findings={domain_id: [] for domain_id in requested_domains},
        run_contract={},
        doc=None,  # type: ignore[arg-type]
        extraction=None,  # type: ignore[arg-type]
        original_page_count=10,
        doc_facts=None,  # type: ignore[arg-type]
        model_id="fake-model",
    )

    # The loop kept going past domain_b's failure instead of unwinding.
    assert seen_domains == requested_domains
    assert outcomes["domain_a"].status == "succeeded"
    assert outcomes["domain_c"].status == "succeeded"
    assert outcomes["domain_b"].status is None
    assert outcomes["domain_b"].error == "transient db error"
    assert outcomes["domain_b"].counts is None
    assert outcomes["domain_b"].flags == 0


async def test_store_domain_packets_still_reraises_lease_lost_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`LeaseLostError` must still propagate out of the loop, unlike an
    ordinary failure: the run has lost its claim, so every remaining domain
    is equally doomed (mirrors `_store_packet`'s own deliberate non-catch of
    this exception, documented in its docstring)."""

    async def _fake_build_and_store(*, domain_id: str, **_kwargs: object) -> DomainOutcome:
        if domain_id == "domain_a":
            raise cds_store.LeaseLostError("lease gone")
        pytest.fail("the loop must stop at the first LeaseLostError, not keep going")

    monkeypatch.setattr(batch_run, "_build_and_store_domain_packet", _fake_build_and_store)

    requested_domains = ["domain_a", "domain_b"]
    with pytest.raises(cds_store.LeaseLostError):
        await batch_run.store_domain_packets(
            pool=None,
            settings=None,
            manifest=None,  # type: ignore[arg-type]
            requested_domains=requested_domains,
            domain_findings={domain_id: [] for domain_id in requested_domains},
            run_contract={},
            doc=None,  # type: ignore[arg-type]
            extraction=None,  # type: ignore[arg-type]
            original_page_count=10,
            doc_facts=None,  # type: ignore[arg-type]
            model_id="fake-model",
        )
