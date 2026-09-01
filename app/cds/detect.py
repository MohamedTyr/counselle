"""Per-file school + academic-year detection for the CDS upload staging table
(plan §B1 `app/cds/detect.py`).

One cheap model call over the document's front matter (native PDF, not the
extracted text layer) plus a fuzzy match against `cds_library.schools`
(2,746 rows, via `adapters/cds_admin_queries.search_schools`). Two corpus
files make this non-trivial, both real and deliberately NOT special-cased by
name here -- this module reads generically off whatever the document says,
never a hardcoded school:

- **A stale running header is not proof.** One corpus file's page-3+ running
  header reads a full year earlier than its own page-1 title and A0/A1
  section say -- majority-voting many pages' headers would pick the WRONG
  year. This module therefore never aggregates many pages of text; it sends
  only the document's first few pages (where the A0/A1 respondent/address
  section and the title both live) to the model once, and instructs it to
  trust that section over any later page header.
- **A corrupted text layer is not proof of a wrong reading.** One corpus
  file's embedded font remaps digits to control-range code points, so
  `pymupdf`'s extracted text is silently wrong -- but the model reads the
  actual PDF bytes (native inline PDF, tokenized as an image tile per page,
  recon-vertex.md §4e), not `pymupdf`'s text layer, so it reads the visually
  printed year/name correctly regardless. This module never extracts local
  text for the identity read itself -- `pymupdf` is used here only to slice
  the page window, never to read content.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from typing import Any

import asyncpg
from pydantic import BaseModel, ConfigDict, Field

from adapters import cds_admin_queries, cds_gemini, cds_pdf
from adapters.cds_admin_types import SchoolSummary as _CatalogRow

# The A0 (respondent info) / A0A / A1 (address info) section -- which carries
# both the institution name and the reporting year in every corpus file --
# always lives in the document's first few pages, never a later body page
# (exactly where the stale-header trap lives).
_DETECTION_PAGE_WINDOW = 3
_SCHOOL_CANDIDATE_LIMIT = 8
_MATCH_CONFIDENT_THRESHOLD = 0.82
# `search_schools` (P3) is a plain SQL substring/prefix match -- it cannot
# know "The Ohio State University" and "Ohio State University-Main Campus"
# are the same institution, or that "Penn State" is short for "Pennsylvania
# State". When the full detected name finds nothing, retry with its
# individual significant words (dropping generic campus/institution words) so
# a single distinctive token -- "Ohio", or "Penn" (a literal substring of
# "Pennsylvania") -- still surfaces the right row.
_GENERIC_NAME_WORDS = frozenset({
    "the", "of", "at", "in", "and", "main", "campus", "park", "university", "college", "state",
})
_WORD_RE = re.compile(r"[a-zA-Z]+")
# "The Ohio State University" vs the catalog's "Ohio State University-Main
# Campus": a leading article is common in an institution's own preferred
# name but never appears in the IPEDS catalog name. Stripped before search
# AND scoring so "Ohio State University" lands as a clean substring/prefix
# of the catalog row instead of just barely out-scoring an unrelated school.
_LEADING_ARTICLE_RE = re.compile(r"^(the)\s+", re.IGNORECASE)

_DETECTION_PROMPT = (
    "This is the first few pages of a Common Data Set (CDS) PDF for a US college or "
    "university. Read the actual page content visually -- if any text looks garbled or "
    "contains stray/control characters, read what is visually printed on the page instead "
    "of trusting that text. Report the institution's name from the A0/A1 respondent or "
    "address information section, and the first year of the CDS edition this document "
    "reports (from the document's own title or A0 section, e.g. 2022 for a document titled "
    "'Common Data Set 2022-2023'). A running header printed on a LATER page can be stale, "
    "carried over from a prior year's template -- if anything conflicts, trust the "
    "document's own title/A0 section over any later page's header. "
    "Only report a value you can actually read from THIS document's own A0/A1 section or "
    "title -- never guess, infer from general knowledge, or fill in a plausible-sounding "
    "answer. If the identity section is blank, unfilled (e.g. an empty template), "
    "illegible, redacted, or names only a generic system/consortium with no specific "
    "campus identified, return null for school_name (and/or academic_year_start) instead "
    "of a guess."
)


class _DetectedIdentity(BaseModel):
    """Structured read of the document's own stated identity -- a claim, not
    a verified fact; `detect_school_year` cross-checks it against the school
    catalog before anything downstream trusts it. Both fields are nullable
    on purpose: the document's own A0/A1 section is sometimes blank,
    illegible, or names only a generic system with no specific campus, and
    the model must be able to say "I can't tell" rather than being forced
    into a syntactically-valid but ungrounded guess (see `detect_school_year`
    and `service_ingest.create_upload` for how a null is handled -- it never
    auto-fills and always falls through to `needs_input`, exactly like a
    low-confidence catalog match)."""

    model_config = ConfigDict(extra="forbid")
    school_name: str | None = Field(
        default=None,
        description="The institution's name exactly as printed in the A0/A1 "
        "respondent/address information section, or null if the document does not "
        "actually state a specific institution's name there.",
    )
    academic_year_start: int | None = Field(
        default=None,
        ge=1980,
        le=2100,
        description="The FIRST year of the Common Data Set edition this document reports "
        "(e.g. 2022 for a document titled 'Common Data Set 2022-2023'), read from the "
        "document's own title/A0 section, never from a later page's running header, or "
        "null if the document does not actually state a year there.",
    )


@dataclass(frozen=True)
class SchoolCandidate:
    """One ranked catalog match. `score` is a name-similarity ratio in
    [0, 1], not a probability -- the admin screen shows it as a rough
    confidence signal, and `DetectionResult.confident` gates auto-fill."""

    school_id: int
    name: str
    state: str | None
    city: str | None
    score: float


@dataclass(frozen=True)
class DetectionResult:
    detected_name: str | None
    detected_academic_year: int | None
    candidates: tuple[SchoolCandidate, ...]
    model_id: str | None
    error: str | None

    @property
    def best_match(self) -> SchoolCandidate | None:
        return self.candidates[0] if self.candidates else None

    @property
    def confident(self) -> bool:
        best = self.best_match
        return best is not None and best.score >= _MATCH_CONFIDENT_THRESHOLD


def _normalize(name: str) -> str:
    return " ".join(_LEADING_ARTICLE_RE.sub("", name.casefold()).split())


def _score(query: str, candidate_name: str) -> float:
    return difflib.SequenceMatcher(None, _normalize(query), _normalize(candidate_name)).ratio()


def _significant_words(name: str) -> list[str]:
    words = [word for word in _WORD_RE.findall(name.casefold()) if len(word) > 2]
    significant = [word for word in words if word not in _GENERIC_NAME_WORDS]
    return significant or words


async def _token_fallback_search(
    pool: asyncpg.Pool, detected_name: str
) -> list[_CatalogRow]:
    """`search_schools` on the full name found nothing -- retry per
    significant word and merge, so one distinctive token still finds the
    right row even when the model's phrasing and the catalog's IPEDS name
    diverge (article, abbreviation, or campus-suffix differences)."""
    seen: dict[int, _CatalogRow] = {}
    for word in _significant_words(detected_name):
        rows = await cds_admin_queries.search_schools(pool, word, limit=_SCHOOL_CANDIDATE_LIMIT)
        for row in rows:
            seen[row.id] = row
        if len(seen) >= _SCHOOL_CANDIDATE_LIMIT * 2:
            break
    return list(seen.values())


def _is_campus_extension(query: str, candidate_name: str) -> bool:
    """True when `candidate_name` is the query plus a trailing campus/branch
    qualifier (e.g. query "university of michigan" vs candidate "university
    of michigan-flint") -- a real potential match, but ambiguous whenever
    more than one campus in the same system extends the same base name."""
    query_n, candidate_n = _normalize(query), _normalize(candidate_name)
    return candidate_n != query_n and (
        candidate_n.startswith(f"{query_n}-") or candidate_n.startswith(f"{query_n} ")
    )


def _cap_ambiguous_campus_extensions(
    candidates: tuple[SchoolCandidate, ...], detected_name: str
) -> tuple[SchoolCandidate, ...]:
    """When >=2 candidates are all "<query>-<branch>" extensions of the same
    base name (a state system's branch campuses), the document's own text
    gave no signal for *which* branch -- cap their scores below the
    confidence threshold rather than silently picking one. Plan intent:
    "return ranked candidates rather than a silent guess" -- the admin
    disambiguates explicitly instead of a coin-flip landing on the wrong
    campus."""
    extensions = {c.school_id for c in candidates if _is_campus_extension(detected_name, c.name)}
    if len(extensions) <= 1:
        return candidates
    cap = _MATCH_CONFIDENT_THRESHOLD - 0.01
    capped = tuple(
        SchoolCandidate(c.school_id, c.name, c.state, c.city, min(c.score, cap))
        if c.school_id in extensions
        else c
        for c in candidates
    )
    return tuple(sorted(capped, key=lambda candidate: candidate.score, reverse=True))


async def _rank_candidates(pool: asyncpg.Pool, detected_name: str) -> tuple[SchoolCandidate, ...]:
    """Ranked catalog matches for the model's claimed school name.
    `search_schools` already does the SQL-side name/alias/search_name match
    (plan §D endpoint #2); this re-ranks by string similarity against the
    canonical name so the single best guess floats to `candidates[0]`,
    with a token-level fallback and branch-campus ambiguity handling on top
    (see `_token_fallback_search` / `_cap_ambiguous_campus_extensions`)."""
    search_name = _LEADING_ARTICLE_RE.sub("", detected_name).strip()
    rows = await cds_admin_queries.search_schools(pool, search_name, limit=_SCHOOL_CANDIDATE_LIMIT)
    if not rows:
        rows = await _token_fallback_search(pool, detected_name)
    scored = [
        SchoolCandidate(row.id, row.name, row.state, row.city, _score(detected_name, row.name))
        for row in rows
    ]
    ranked = tuple(sorted(scored, key=lambda candidate: candidate.score, reverse=True))
    return _cap_ambiguous_campus_extensions(ranked, detected_name)


async def detect_school_year(
    *, settings: Any, pool: asyncpg.Pool, pdf_content: bytes
) -> DetectionResult:
    """Detect an uploaded document's school and academic year: one model
    call over its first pages (native PDF, visual read) plus a fuzzy match
    against the school catalog.

    Never raises on an unreadable PDF or an empty/malformed model response --
    `DetectionResult.error` carries the reason and `candidates` is empty, so
    the admin upload screen falls back to manual entry (plan §D endpoints
    #3/#5) instead of the whole upload request failing.
    """
    try:
        page_count = await cds_pdf.get_page_count(pdf_content)
        window = list(range(1, min(_DETECTION_PAGE_WINDOW, page_count) + 1))
        narrowed_bytes, _page_map = await cds_pdf.narrow_document(pdf_content, window)
        result = await cds_gemini.generate_structured(
            settings=settings,
            prompt=_DETECTION_PROMPT,
            response_schema=_DetectedIdentity,
            pdf_bytes=narrowed_bytes,
            model_setting=settings.model_cds_detect,
        )
    except (cds_pdf.CdsPdfError, cds_gemini.CdsGeminiError) as exc:
        return DetectionResult(None, None, (), None, str(exc))
    if not isinstance(result.parsed, _DetectedIdentity):
        return DetectionResult(
            None, None, (), result.model_id, "model returned an unexpected shape"
        )
    identity = result.parsed
    # A null school_name means the model itself found no groundable identity
    # to report (blank/illegible A0/A1 section, generic system name, ...) --
    # there is nothing to fuzzy-match against the catalog, so `candidates`
    # stays empty and `DetectionResult.confident` is naturally False. That
    # routes through the *existing* `needs_input` path (same as a genuine
    # low-score match) with no new status or confidence framework needed.
    candidates: tuple[SchoolCandidate, ...] = ()
    if identity.school_name is not None:
        candidates = await _rank_candidates(pool, identity.school_name)
    return DetectionResult(
        identity.school_name, identity.academic_year_start, candidates, result.model_id, None
    )


__all__ = ["DetectionResult", "SchoolCandidate", "detect_school_year"]
