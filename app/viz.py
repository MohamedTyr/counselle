"""The ``render_viz`` tool — the LLM picks the shape, this tool fetches the numbers.

ADR 0014 / ARCHITECTURE §17 (Slice D). The provenance boundary lives here:
every cell is a :class:`CitationEnvelope` fetched **directly in-process** from
``counselle_db.service`` (eng-review D2 — never through the MCP child). The
built :class:`RenderSpec` is appended to the state-owned ``viz_emitted`` list
(streamed to the client as a ``viz`` event); the LLM receives only a small
acknowledgment with citation markers — **numbers never transit the LLM's
tokens**, success or error.

Score-band field keys are FIXED by the chart definition (the §17 honesty
trap): SAT renders as two per-section rows (EBRW, Math) — never a fabricated
1600 composite; ACT composite percentiles exist directly. The
:class:`RenderSpec` validator enforces the no-composite rule a second time.
"""

import logging
from typing import Any, Literal

from app.sources import SourceRegistry
from counselle_db.catalog import Catalog
from counselle_db.models import FieldKeyError, ResolveMatch, ServiceError
from counselle_db.service import compare_schools, get_values, resolve_school
from domain.envelope import CitationEnvelope
from domain.specs import RenderSpec, SchoolRef, ScoreBand, VizRow
from domain.urls import registrable_domain

logger = logging.getLogger(__name__)

VizType = Literal["stat_block", "comparison_table", "score_band"]
TestName = Literal["sat", "act", "both"]

#: ADR 0014 fixed band rows — (row label, [25th key, 75th key]). NEVER mix sections.
_SAT_BAND_ROWS: list[tuple[str, list[str]]] = [
    ("SAT EBRW (middle 50%)", ["admissions.sat_ebrw_25", "admissions.sat_ebrw_75"]),
    ("SAT Math (middle 50%)", ["admissions.sat_math_25", "admissions.sat_math_75"]),
]
_ACT_BAND_ROWS: list[tuple[str, list[str]]] = [
    ("ACT Composite (middle 50%)", ["admissions.act_composite_25", "admissions.act_composite_75"]),
]
_BAND_ROWS: dict[str, list[tuple[str, list[str]]]] = {
    "sat": _SAT_BAND_ROWS,
    "act": _ACT_BAND_ROWS,
    "both": _SAT_BAND_ROWS + _ACT_BAND_ROWS,
}
_TEST_DISPLAY = {"sat": "SAT", "act": "ACT", "both": "SAT & ACT"}


#: The DB field whose value is each school's official website (R8: scheme may be
#: absent). The host drives the client-side logo; ``registrable_domain`` is robust
#: to both ``https://www.x.edu/`` and bare ``www.x.edu/`` shapes.
_WEBSITE_KEY = "institution.website"


async def _school_ref(catalog: Catalog, unitid: int) -> SchoolRef:
    """Resolve a unitid to a named SchoolRef; unknown unitid → ServiceError."""
    result = await resolve_school(catalog, str(unitid))
    if not isinstance(result, ResolveMatch):
        raise ServiceError(f"unitid {unitid} is not in our database")
    return SchoolRef(unitid=unitid, name=result.school.name)


async def _domains(catalog: Catalog, unitids: list[int]) -> dict[int, str | None]:
    """Map each unitid → its website host, in ONE batched query.

    Best-effort and never fatal: a school with no website (or a website we can't
    parse to a host) maps to ``None``, and any DB hiccup degrades the whole map to
    empty — a viz without logos still renders. Logos are decoration, never data.
    """
    if not unitids:
        return {}
    try:
        result = await compare_schools(catalog, unitids, [_WEBSITE_KEY])
    except Exception:
        logger.warning("viz: website lookup failed for %s; rendering without logos", unitids)
        return {}
    cells = result.rows[0].cells if result.rows else []
    return {
        school.unitid: (registrable_domain(cell.display) if cell.available else None)
        for school, cell in zip(result.schools, cells, strict=False)
    }


def _with_domains(schools: list[SchoolRef], domains: dict[int, str | None]) -> list[SchoolRef]:
    """Attach each school's website host (immutably) so the client can show a logo."""
    return [school.model_copy(update={"domain": domains.get(school.unitid)}) for school in schools]


async def _comparison_spec(
    catalog: Catalog, unitids: list[int], field_keys: list[str] | None, title: str | None
) -> RenderSpec:
    if not field_keys:
        raise ServiceError("comparison_table needs field_keys — pick the fields that matter here")
    result = await compare_schools(catalog, unitids, field_keys)
    schools = [SchoolRef(unitid=s.unitid, name=s.name) for s in result.schools]
    schools = _with_domains(schools, await _domains(catalog, [s.unitid for s in schools]))
    rows = [VizRow(label=row.label, cells=row.cells) for row in result.rows]
    if not rows:
        unknown = [error.field for error in result.errors]
        raise ServiceError(f"unknown field key(s): {unknown} — use real catalog keys")
    return RenderSpec(
        type="comparison_table",
        title=title or " vs ".join(school.name for school in schools),
        schools=schools,
        rows=rows,
    )


async def _stat_block_spec(
    catalog: Catalog, unitids: list[int], field_keys: list[str] | None, title: str | None
) -> RenderSpec:
    if not field_keys:
        raise ServiceError("stat_block needs field_keys — pick the fields that matter here")
    unitid = unitids[0]  # a stat block is one school (ADR 0014)
    school = await _school_ref(catalog, unitid)
    school = _with_domains([school], await _domains(catalog, [unitid]))[0]
    envelopes = await get_values(catalog, unitid, field_keys)
    rows = [
        VizRow(label=env.label, cells=[env])
        for env in envelopes
        if isinstance(env, CitationEnvelope)
    ]
    if not rows:
        unknown = [env.field for env in envelopes if isinstance(env, FieldKeyError)]
        raise ServiceError(f"unknown field key(s): {unknown} — use real catalog keys")
    return RenderSpec(
        type="stat_block",
        title=title or f"{school.name} — key facts",
        schools=[school],
        rows=rows,
    )


async def _score_band_spec(
    catalog: Catalog,
    unitids: list[int],
    field_keys: list[str] | None,
    test: TestName | None,
    title: str | None,
) -> RenderSpec:
    if field_keys is not None:
        raise ServiceError(
            "score_band field keys are fixed by the chart definition — do not pass "
            "field_keys; pick only test ('sat' | 'act' | 'both') and the schools"
        )
    if test not in _BAND_ROWS:
        raise ServiceError("score_band requires test='sat' | 'act' | 'both'")
    schools = [await _school_ref(catalog, unitid) for unitid in unitids]
    schools = _with_domains(schools, await _domains(catalog, [s.unitid for s in schools]))
    rows: list[VizRow] = []
    for school in schools:
        for row_label, keys in _BAND_ROWS[test]:
            envelopes = await get_values(catalog, school.unitid, keys)
            cells = [env for env in envelopes if isinstance(env, CitationEnvelope)]
            label = row_label if len(schools) == 1 else f"{school.name} — {row_label}"
            rows.append(VizRow(label=label, cells=cells))
    return RenderSpec(
        type="score_band",
        title=title or f"{_TEST_DISPLAY[test]} middle 50% (enrolled students — not a cutoff)",
        schools=schools,
        rows=rows,
        band=ScoreBand(test=test),
    )


async def _build_spec(
    catalog: Catalog,
    type: VizType,
    unitids: list[int],
    field_keys: list[str] | None,
    test: TestName | None,
    title: str | None,
) -> RenderSpec:
    if not unitids:
        raise ServiceError("render_viz needs at least one unitid")
    if type == "comparison_table":
        return await _comparison_spec(catalog, unitids, field_keys, title)
    if type == "stat_block":
        return await _stat_block_spec(catalog, unitids, field_keys, title)
    return await _score_band_spec(catalog, unitids, field_keys, test, title)


async def render_viz(
    catalog: Catalog,
    registry: SourceRegistry,
    viz_emitted: list[dict[str, Any]],
    type: VizType,
    unitids: list[int],
    field_keys: list[str] | None = None,
    test: TestName | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Render a visualization for the student; values are fetched, never typed.

    You pick the SHAPE — which schools, which fields, which chart type; this
    tool fetches the exact cited values from the database and shows them to
    the student directly. You never see (and must never invent) the numbers:
    on success you get only ``{"ok": true, "viz": "<type> rendered with N
    values", "sources": ["[3]", ...]}`` — cite those markers next to the
    prose that refers to the visualization.

    Types: ``comparison_table`` (N schools × your field_keys),
    ``stat_block`` (ONE school × your field_keys), ``score_band`` (middle-50%
    test bands; field keys are fixed — pass ``test`` and schools only).
    """
    try:
        spec = await _build_spec(catalog, type, unitids, field_keys, test, title)
    except ServiceError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception:
        logger.exception(
            "render_viz: unexpected error building spec (type=%s, unitids=%s)", type, unitids
        )
        return {
            "ok": False,
            "error": (
                "visualization data unavailable — a database error occurred; do not invent values"
            ),
        }
    cells = [cell for row in spec.rows for cell in row.cells]
    n_available = sum(1 for cell in cells if cell.available)
    if n_available == 0:
        return {
            "ok": False,
            "error": "no values available for this visualization — tell the student "
            "honestly that this data is not available; do not invent values",
        }
    # Label falls back to the vintage — for DB envelopes it is already the
    # human source string (same convention as SourceRegistry._register_dict).
    markers = sorted({registry.register(cell.citation, cell.citation.vintage) for cell in cells})
    viz_emitted.append(spec.model_dump(mode="json"))
    return {
        "ok": True,
        "viz": f"{type} rendered with {n_available} values",
        "sources": [f"[{index}]" for index in markers],
    }
