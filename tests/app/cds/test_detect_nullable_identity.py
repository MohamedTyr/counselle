"""Regression test for the deeper cause behind f74ceb5's honesty fix:
`detect._DetectedIdentity.school_name`/`academic_year_start` used to be
required, non-nullable fields, so the schema-constrained model call was
forced to answer with SOME school and year even when the document's own
A0/A1 section gave it nothing to go on.

Live-reproduced (not committed) against a document that passes
`cds_pdf.sanity_check_cds_pdf` (a real "Common Data Set" title on page 1) but
whose identity fields are blank and only a generic, non-specific affiliation
string is present ("State University System"): the pre-fix model answered
that literal string as `school_name`, which fuzzy-matched a REAL catalog row
("Arkansas State University System") at score 0.836 -- above
`_MATCH_CONFIDENT_THRESHOLD` (0.82) -- so `sanity_check_cds_pdf` alone (the
f74ceb5 fix) does not close this gap: a document can legitimately look like a
CDS filing while still having no actual per-institution identity to read.

The fix here: both fields are nullable, and the prompt explicitly authorises
"I can't tell" for a blank/illegible/generic-only identity section.
`detect_school_year` skips catalog ranking entirely when `school_name` is
null, so `candidates` stays empty and `DetectionResult.confident` is
naturally False -- routing through the *existing* `needs_input` path with no
new status or confidence framework.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from adapters import cds_admin_queries, cds_gemini
from adapters.cds_admin_types import SchoolSummary
from app.cds import detect
from tests.pdf_fixtures import build_pdf

_SETTINGS = SimpleNamespace(model_cds_detect="google-vertex:fake-model")


async def _fake_search_schools_never_called(
    pool: Any, q: str, *, limit: int = 20
) -> list[SchoolSummary]:
    raise AssertionError(
        "search_schools must not be called when the model reports no groundable name"
    )


class TestNullSchoolNameSkipsCatalogRanking:
    async def test_no_candidates_when_model_reports_no_name(self, monkeypatch: Any) -> None:
        async def fake_generate_structured(
            *, settings: Any, prompt: str, response_schema: type, **_: Any
        ) -> cds_gemini.GenerateResult:
            parsed = response_schema(school_name=None, academic_year_start=2023)
            return cds_gemini.GenerateResult(
                parsed=parsed,
                usage=cds_gemini.Usage(
                    prompt_tokens=1, output_tokens=1, thoughts_tokens=0, cached_tokens=0,
                    total_tokens=2,
                ),
                latency_seconds=0.01,
                model_id="fake-detect-model",
                finish_reason="STOP",
            )

        monkeypatch.setattr(cds_gemini, "generate_structured", fake_generate_structured)
        monkeypatch.setattr(
            cds_admin_queries, "search_schools", _fake_search_schools_never_called
        )

        result = await detect.detect_school_year(
            settings=_SETTINGS, pool=object(), pdf_content=build_pdf()
        )

        assert result.detected_name is None
        assert result.candidates == ()
        assert result.confident is False
        assert result.best_match is None

    async def test_year_still_reported_even_when_name_is_not(self, monkeypatch: Any) -> None:
        """A null school_name must not silently drop a year the model DID
        read -- the admin's manual-entry form still benefits from it."""

        async def fake_generate_structured(
            *, settings: Any, prompt: str, response_schema: type, **_: Any
        ) -> cds_gemini.GenerateResult:
            parsed = response_schema(school_name=None, academic_year_start=2023)
            return cds_gemini.GenerateResult(
                parsed=parsed,
                usage=cds_gemini.Usage(
                    prompt_tokens=1, output_tokens=1, thoughts_tokens=0, cached_tokens=0,
                    total_tokens=2,
                ),
                latency_seconds=0.01,
                model_id="fake-detect-model",
                finish_reason="STOP",
            )

        monkeypatch.setattr(cds_gemini, "generate_structured", fake_generate_structured)
        monkeypatch.setattr(
            cds_admin_queries, "search_schools", _fake_search_schools_never_called
        )

        result = await detect.detect_school_year(
            settings=_SETTINGS, pool=object(), pdf_content=build_pdf()
        )

        assert result.detected_academic_year == 2023


class TestARealDetectedNameStillRanksNormally:
    """The nullable schema must not change behaviour for the common case: a
    document the model can actually read still ranks catalog candidates
    exactly as before."""

    async def test_a_real_name_still_gets_ranked(self, monkeypatch: Any) -> None:
        async def fake_generate_structured(
            *, settings: Any, prompt: str, response_schema: type, **_: Any
        ) -> cds_gemini.GenerateResult:
            parsed = response_schema(school_name="Spelman College", academic_year_start=2023)
            return cds_gemini.GenerateResult(
                parsed=parsed,
                usage=cds_gemini.Usage(
                    prompt_tokens=1, output_tokens=1, thoughts_tokens=0, cached_tokens=0,
                    total_tokens=2,
                ),
                latency_seconds=0.01,
                model_id="fake-detect-model",
                finish_reason="STOP",
            )

        async def fake_search_schools(
            pool: Any, q: str, *, limit: int = 20
        ) -> list[SchoolSummary]:
            return [SchoolSummary(id=1, name="Spelman College", state="GA", city="Atlanta")]

        monkeypatch.setattr(cds_gemini, "generate_structured", fake_generate_structured)
        monkeypatch.setattr(cds_admin_queries, "search_schools", fake_search_schools)

        result = await detect.detect_school_year(
            settings=_SETTINGS, pool=object(), pdf_content=build_pdf()
        )

        assert result.detected_name == "Spelman College"
        assert result.confident is True
        assert result.best_match is not None
        assert result.best_match.name == "Spelman College"
