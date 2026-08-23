"""The deterministic accuracy gate: ``(packet, doc_facts) -> ReviewFlag[]``.

Every function here is pure and honesty-critical (AGENTS.md's one hard testing
carve-out — data-integrity code is tested hard, always). Flags are **advisory
to the human**, never a silent mutation: a flagged field keeps its extracted
value and shows the reason (plan §B4). Each message must tell an admin exactly
what is wrong, because it becomes the review-screen text verbatim.

``doc_facts`` carries the local, independently-computed signals a validator
checks the packet against (page text for excerpt matching, a corruption probe
result, the expected academic year) — computed by adapters in P2, not here.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict

#: ``error`` is **blocking** -- `app/cds/service_review.py::_flags_summary`
#: counts it against `unresolved` and the approve gate refuses to proceed
#: without ``override_flags=true``. ``warning`` is **advisory** -- always
#: shown on the review screen (never suppressed), never blocks Approve on
#: its own. A validator earns "error" only when it can directly prove a
#: *value* is wrong (arithmetic contradiction, a stale document year); a
#: validator that can only say "the evidence for this value isn't
#: independently provable" (a citation the text layer can't confirm) stays
#: "warning" -- see `plans/cds-pipeline/flag-precision.md` for the measured
#: justification.
Severity = Literal["error", "warning"]

_WHITESPACE = re.compile(r"\s+")
_LEADING_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
_ACADEMIC_YEAR = re.compile(r"^(\d{4})[-/](?:\d{2}|\d{4})$")
_FUZZY_WORD_HIT_RATIO = 0.8
#: A 2-word "<label> <value>" excerpt (e.g. "Total 798") is exactly the shape
#: `packet_build`'s findings take for CDS grid cells (recon-cds-corpus.md §5's
#: label/number-decoupled Excel-exported tables), and the label and value
#: routinely land in different rows of the extracted text -- verbatim-adjacent
#: only by luck. Requiring both words present (not adjacent) still demands
#: real evidence; it only stops penalizing a real value for the exporter's
#: layout, not for actually being unverifiable. Below 2 words there's nothing
#: left to fuzzy-match against, so a lone token still needs an exact
#: substring hit. Raised from 3 after `plans/cds-pipeline/flag-precision.md`
#: found 2-word decoupled excerpts as a real false-alarm source with the
#: value confirmed correct on the same page.
_MIN_WORDS_FOR_FUZZY = 2

# Glyph variants that mean the same character but break a naive substring
# match: curly quotes, en/em/minus dashes, and common typeset ligatures.
# Calibrated against `plans/cds-pipeline/flag-precision.md`'s sample --
# Gemini's excerpt (reading the rendered page image) and PyMuPDF's
# `get_text()` (reading the embedded font table) can disagree on which
# literal codepoint represents the same visible glyph.
_GLYPH_VARIANTS = str.maketrans({
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "−": "-", "‑": "-",
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
})
# A hyphen immediately followed by whitespace is almost always a PDF
# line-wrap artifact reinserted by `get_text()` at a hyphenated word break
# (e.g. "CLASS SUB-\nSECTIONS" -> "sub- sections" after whitespace
# collapse), not two separate hyphenated words -- collapse it back to a
# plain hyphen so a genuinely-on-page excerpt like "SUB-SECTIONS" matches.
_HYPHEN_LINEBREAK = re.compile(r"(?<=\w)-\s+")


class ReviewFlag(BaseModel):
    """One advisory flag surfaced on the review screen."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    code: str
    severity: Severity
    message: str
    metric_ref: str | None = None


@dataclass(frozen=True)
class DocFacts:
    """Local, independently-computed facts about the source document — never
    derived from the model's own claims."""

    page_text: Mapping[int, str] = field(default_factory=dict)
    corrupt_text_layer: bool = False
    expected_academic_year: int | None = None


def normalize_text(text: str) -> str:
    text = text.translate(_GLYPH_VARIANTS).replace("\xa0", " ")
    text = _WHITESPACE.sub(" ", text)
    text = _HYPHEN_LINEBREAK.sub("-", text)
    return text.strip().casefold()


def fuzzy_contains(excerpt: str, page_text: str) -> bool:
    """Excerpt is on the page, tolerating whitespace/OCR noise — not an exact
    substring requirement, but not "the excerpt is nowhere near this page" either."""
    if not excerpt:
        return True
    if excerpt in page_text:
        return True
    words = excerpt.split()
    if len(words) < _MIN_WORDS_FOR_FUZZY:
        return excerpt in page_text
    hits = sum(1 for word in words if word in page_text)
    return hits / len(words) >= _FUZZY_WORD_HIT_RATIO


def _verified(metric: dict[str, Any] | None) -> bool:
    return metric is not None and metric.get("extraction_status") == "verified"


def _reported_number(metric: dict[str, Any] | None) -> float | None:
    if metric is None or not _verified(metric) or metric.get("availability_status") != "reported":
        return None
    value = metric.get("value")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def excerpt_on_cited_page(packet: dict[str, Any], doc_facts: DocFacts) -> list[ReviewFlag]:
    """Closes the biggest hole in the old pipeline (recon §5, critique #4): a
    confidently-wrong page citation is otherwise undetectable."""
    flags: list[ReviewFlag] = []
    for ref, metric in packet.get("metrics", {}).items():
        evidence = metric.get("evidence")
        if not _verified(metric) or not evidence:
            continue
        page_text = doc_facts.page_text.get(evidence["page_number"])
        if page_text is None:
            continue  # no local text to check against; absence is not proof
        excerpt = normalize_text(evidence["excerpt"])
        if not fuzzy_contains(excerpt, normalize_text(page_text)):
            flags.append(ReviewFlag(
                code="excerpt_not_on_cited_page",
                severity="warning",
                metric_ref=ref,
                message=(
                    f"{ref}: cited page {evidence['page_number']} does not contain the excerpt "
                    f"\"{evidence['excerpt'][:80]}\" — possible hallucinated page citation."
                ),
            ))
    return flags


def corrupt_text_layer(packet: dict[str, Any], doc_facts: DocFacts) -> list[ReviewFlag]:
    """Caltech-class failure: broken ToUnicode CMaps silently shift printed digits
    (recon §4 risk register #4). Once the document is flagged corrupt at ingest,
    every digit-bearing verified value needs a visual re-check."""
    if not doc_facts.corrupt_text_layer:
        return []
    flags: list[ReviewFlag] = []
    for ref, metric in packet.get("metrics", {}).items():
        if _reported_number(metric) is None:
            continue
        page = (metric.get("evidence") or {}).get("page_number", "?")
        flags.append(ReviewFlag(
            code="corrupt_text_layer",
            severity="warning",
            metric_ref=ref,
            message=(
                f"{ref}: this document's PDF text layer is corrupted (broken ToUnicode CMap); "
                f"the numeric value {metric['value']!r} on page {page} may be silently wrong "
                "digits and needs a visual re-check."
            ),
        ))
    return flags


def _parse_academic_year(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    match = _ACADEMIC_YEAR.match(value.strip())
    return int(match.group(1)) if match else None


def year_consistency(packet: dict[str, Any], doc_facts: DocFacts) -> list[ReviewFlag]:
    """Cornell-class failure: a stale CDS edition header printed on most pages
    (recon §4 risk register #4). Cross-checks against the upload/filename-derived
    year, never a document-wide majority vote."""
    if doc_facts.expected_academic_year is None:
        return []
    metric = packet.get("metrics", {}).get("identity.academic_year")
    if not _verified(metric) or metric.get("availability_status") != "reported":
        return []
    parsed = _parse_academic_year(metric.get("value"))
    if parsed is None or parsed == doc_facts.expected_academic_year:
        return []
    return [ReviewFlag(
        code="year_consistency",
        severity="error",
        metric_ref="identity.academic_year",
        message=(
            f"identity.academic_year: document text reads {metric['value']!r} (parsed as "
            f"{parsed}) but the upload indicates academic year {doc_facts.expected_academic_year} "
            "— possible stale CDS edition header carried over from a prior year."
        ),
    )]


_ORDER_RULES: tuple[tuple[str, str, str, str], ...] = (
    ("admissions.admitted_total", "admissions.applicants_total", "admits", "applicants"),
    ("admissions.enrolled_total", "admissions.admitted_total", "enrolled", "admits"),
)


def _metric_definition(packet: dict[str, Any], ref: str) -> dict[str, Any] | None:
    contract = packet.get("provider_contract") or {}
    for domain in contract.get("metric_definitions", []):
        for metric in domain.get("metrics", []):
            if metric.get("id") == ref:
                return cast(dict[str, Any], metric)
    return None


def _coerce_percent(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = _LEADING_NUMBER.search(value)
        if match:
            return float(match.group(0))
    return None


def _order_flags(metrics: dict[str, Any]) -> list[ReviewFlag]:
    flags: list[ReviewFlag] = []
    for greater_ref, lesser_ref, greater_label, lesser_label in _ORDER_RULES:
        greater = _reported_number(metrics.get(greater_ref))
        lesser = _reported_number(metrics.get(lesser_ref))
        if greater is not None and lesser is not None and greater > lesser:
            flags.append(ReviewFlag(
                code="denominator_sanity",
                severity="error",
                metric_ref=greater_ref,
                message=(
                    f"{greater_ref}: {greater_label} ({greater:,.0f}) > {lesser_label} "
                    f"({lesser:,.0f}) — {lesser_label} must be at least {greater_label}."
                ),
            ))
    return flags


def _percent_range_flags(packet: dict[str, Any]) -> list[ReviewFlag]:
    flags: list[ReviewFlag] = []
    for ref, metric in packet.get("metrics", {}).items():
        if not _verified(metric) or metric.get("availability_status") != "reported":
            continue
        definition = _metric_definition(packet, ref)
        if definition is None or definition.get("unit") != "percent":
            continue
        number = _coerce_percent(metric.get("value"))
        if number is not None and not (0 <= number <= 100):
            flags.append(ReviewFlag(
                code="denominator_sanity",
                severity="error",
                metric_ref=ref,
                message=(
                    f"{ref}: percent value {metric['value']!r} is outside the valid 0-100 range."
                ),
            ))
    return flags


def denominator_sanity(packet: dict[str, Any], doc_facts: DocFacts) -> list[ReviewFlag]:
    """Pure arithmetic over verified siblings in the same packet: admits <=
    applicants, enrolled <= admits, and any ``unit: percent`` value staying
    inside 0-100."""
    metrics = packet.get("metrics", {})
    return _order_flags(metrics) + _percent_range_flags(packet)


VALIDATORS = (excerpt_on_cited_page, corrupt_text_layer, year_consistency, denominator_sanity)


def run_validators(packet: dict[str, Any], doc_facts: DocFacts) -> list[ReviewFlag]:
    """Run every validator and concatenate the flags, in a fixed, documented order."""
    return [flag for validator in VALIDATORS for flag in validator(packet, doc_facts)]


__all__ = [
    "VALIDATORS",
    "DocFacts",
    "ReviewFlag",
    "corrupt_text_layer",
    "denominator_sanity",
    "excerpt_on_cited_page",
    "fuzzy_contains",
    "normalize_text",
    "run_validators",
    "year_consistency",
]
