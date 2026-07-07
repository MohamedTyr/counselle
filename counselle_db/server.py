"""The counselle-db MCP server — a thin shell over the service layer (eng-review D2).

Every tool below is a ~3-line wrapper: grab the catalog from the lifespan state,
delegate to the matching ``counselle_db.service`` function, ``model_dump()`` the
typed result. ALL tool logic lives in ``service.py``/``service_find.py``; the
docstrings here are the agent-facing contracts (ARCHITECTURE §8, ADRs 0004/0005).

Run over stdio: ``uv run python -m counselle_db.server``.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import wraps
from typing import Any

import structlog
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.session import ServerSession

from config.logging import setup_logging
from config.settings import get_settings
from counselle_db import service
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool
from counselle_db.search_fields import FieldHit, search_fields
from counselle_db.service_find import FindCriteria

logger = structlog.get_logger(__name__)


@dataclass
class AppState:
    """Lifespan state shared by every tool call."""

    catalog: Catalog


@asynccontextmanager
async def _lifespan(_server: FastMCP) -> AsyncIterator[AppState]:
    """Open the read pool + load the catalog at startup; close on shutdown.

    The MCP child READS the field index (search_fields' vector path); it does not
    maintain it. The single reconcile owner is the API process (audit H4) — see
    ``counselle_db/reconcile.py`` and ``api/main.py``.
    """
    settings = get_settings()
    # stdout is the JSON-RPC channel — route all structlog output to stderr.
    setup_logging(settings.log_level)
    pool = await create_pool()
    try:
        catalog = await Catalog.load(pool)
        yield AppState(catalog=catalog)
    finally:
        await pool.close()


mcp = FastMCP("counselle-db", lifespan=_lifespan)

#: The tool-side context type: lifespan state is :class:`AppState`.
AppContext = Context[ServerSession, AppState]


async def _catalog(ctx: AppContext) -> Catalog:
    catalog: Catalog = ctx.request_context.lifespan_context.catalog
    await catalog.maybe_refresh()  # hourly catalog refresh (catalog.py contract)
    return catalog


_SECRETISH_ERROR_TEXT = (
    "postgresql://",
    "mysql://",
    "password",
    "api_key",
    "secret",
    "token",
    "dsn",
)


def _safe_root_cause(message: str) -> str:
    lowered = message.lower()
    if any(needle in lowered for needle in _SECRETISH_ERROR_TEXT):
        return "database tool failed without a shareable error message"
    return message


def _tool_error_payload(message: str) -> dict[str, Any]:
    return {
        "error": "tool_error",
        "root_cause": _safe_root_cause(message),
        "safe_retry": (
            "Adjust the tool arguments using the root_cause, then retry once if "
            "the request still needs this data."
        ),
        "stop_condition": (
            "If the root cause says the data is unavailable or the request is "
            "outside the database contract, say so instead of retrying."
        ),
    }


def tool_errors(fn: Any) -> Any:
    """Return D6-shaped tool errors for expected service-layer failures."""

    @wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return await fn(*args, **kwargs)
        except service.ServiceError as exc:
            return _tool_error_payload(str(exc))
        except Exception as exc:
            logger.warning("mcp_tool_unexpected_error", tool=fn.__name__, exc_info=True)
            return _tool_error_payload(f"database tool failed: {exc}")

    return wrapper


@mcp.tool()
@tool_errors
async def resolve_school(query: str, ctx: AppContext) -> dict[str, Any]:
    """Resolve a school name, abbreviation, or unitid to one school.

    Returns status="match" (basics + coverage_tier: how deep our data goes for this
    school), status="candidates" (multiple campuses — main campus first; ask the
    student if genuinely ambiguous), or status="not_found" (the school is not in our
    database of curated 4-year US institutions — say so honestly, never invent).
    """
    return (await service.resolve_school(await _catalog(ctx), query)).model_dump(mode="json")


@mcp.tool()
@tool_errors
async def get_values(unitid: int, field_keys: list[str], ctx: AppContext) -> list[dict[str, Any]]:
    """Fetch specific fields for one school as citation envelopes.

    Each value comes back normalized, formatted, dated, and cited — use `display`
    verbatim in prose, `raw` for math/visuals. Unknown field keys return per-key
    error entries; a known key with no stored value returns available=false —
    values are never invented.
    """
    results = await service.get_values(await _catalog(ctx), unitid, field_keys)
    return [item.model_dump(mode="json") for item in results]


@mcp.tool()
@tool_errors
async def get_dossier(
    unitid: int, ctx: AppContext, sections: list[str] | None = None
) -> dict[str, Any]:
    """The curated school dossier: shortlist sections A-F, top programs, diversity.

    One cited bundle per school — basics + coverage tier, the curated field
    shortlist grouped into sections (default: all of A-F), a top-10 programs
    preview, and the undergrad diversity breakdown. Every value is an envelope.
    """
    dossier = await service.get_dossier(await _catalog(ctx), unitid, sections)
    return dossier.model_dump(mode="json")


@mcp.tool()
@tool_errors
async def compare_schools(
    unitids: list[int], field_keys: list[str], ctx: AppContext
) -> dict[str, Any]:
    """Compare up to 6 schools across up to 25 fields as an N×M envelope matrix.

    Each cell is a citation envelope (missing data → available=false, never
    invented). Unknown field keys are listed in `errors`. Cells are ordered to
    match the input unitids.
    """
    result = await service.compare_schools(await _catalog(ctx), unitids, field_keys)
    return result.model_dump(mode="json")


@mcp.tool()
@tool_errors
async def find_schools(criteria: FindCriteria, ctx: AppContext) -> list[dict[str, Any]]:
    """Filter and rank schools across the whole database.

    Criteria: state, control (public | private_nonprofit | private_forprofit),
    max/min_admit_rate, min_sat_avg, max_net_price, plus up to 8 generic
    field_filters ({field_key, op: lt|lte|gt|gte|eq, value}) and an optional
    order_by ({field_key, dir: asc|desc}). Percent values are 0-1 fractions
    (0.30, not 30). Limit defaults to 20, max 50. Returns school basics plus the
    filtered values as citation envelopes.
    """
    hits = await service.find_schools(await _catalog(ctx), criteria)
    return [hit.model_dump(mode="json") for hit in hits]


@mcp.tool()
@tool_errors
async def national_benchmark(field_key: str, ctx: AppContext) -> dict[str, Any]:
    """National distribution for one numeric field: median, mean, p25, p75, n.

    The honest backbone for "is X high?" questions — each stat carries both the
    raw number and a display string normalized like every other value.
    """
    result = await service.national_benchmark(await _catalog(ctx), field_key)
    return result.model_dump(mode="json")


@mcp.tool()
@tool_errors
async def get_programs(
    unitid: int, ctx: AppContext, cip_prefix: str | None = None, credlev: int = 3
) -> list[dict[str, Any]]:
    """Programs by major (College Scorecard field-of-study): completions, debt, earnings.

    credlev 3 = bachelor's (default). Optional cip_prefix filters by CIP code prefix.
    Suppressed cells (small cohorts) stay null — never invented. Earnings/debt lag
    the entry cohort by years; each row carries the Scorecard citation.
    """
    rows = await service.get_programs(await _catalog(ctx), unitid, cip_prefix, credlev)
    return [row.model_dump(mode="json") for row in rows]


@mcp.tool()
@tool_errors
async def get_diversity(unitid: int, ctx: AppContext) -> dict[str, Any] | None:
    """Undergraduate enrollment by race/ethnicity and sex (IPEDS fall enrollment).

    Total/men/women plus 9 race/ethnicity groups; unreported cells are null.
    Returns null if the school reported no undergrad enrollment row.
    """
    breakdown = await service.get_diversity(await _catalog(ctx), unitid)
    return breakdown.model_dump(mode="json") if breakdown else None


@mcp.tool()
@tool_errors
async def query_database(
    sql: str, ctx: AppContext, params: list[Any] | None = None
) -> dict[str, Any]:
    """Guarded read-only SQL escape hatch (Layer 3) for what the typed tools don't cover.

    One SELECT/WITH statement, parameterized ($1, $2, ...), row-capped. IMPORTANT:
    raw rows bypass normalization — the reading rules still apply. Prefer the
    helpers counselle.decode_ipeds(table, column, code) to decode IPEDS coded ints
    and counselle.value_vintage(unitid, field_key) for provenance. Percent values
    are 0-1 fractions (0.036 = 3.6%). Negative IPEDS sentinels mean missing, not
    negative quantities.
    """
    result = await service.query_database(await _catalog(ctx), sql, params)
    return result.model_dump(mode="json")


@mcp.tool()
@tool_errors
async def get_data_calendar(ctx: AppContext) -> list[dict[str, Any]]:
    """Each data source's vintage and knowledge cutoff (IPEDS, Scorecard, CDS).

    Derived live from the database — use it to judge whether a question falls
    beyond a source's cutoff and should be routed to the web instead.
    """
    entries = await service.get_data_calendar(await _catalog(ctx))
    return [entry.model_dump(mode="json") for entry in entries]


@mcp.tool(name="search_fields")
@tool_errors
async def discover_fields(
    query: str,
    ctx: AppContext,
    category: str | None = None,
    source: str | None = None,
    limit: int = 8,
    use_vector: bool | None = None,
) -> list[dict[str, Any]]:
    """Discover which catalog fields answer a natural-language question (ADR 0008).

    Hybrid search: cosine vector similarity against counselle.field_index (when
    the index is populated) PLUS always-on keyword fallback (key/label ILIKE +
    pg_trgm), merged so vector hits come first and exact-match keyword hits are
    never crowded out. A field absent from the index is still found via keyword —
    new fields are never invisible.

    Returns up to ``limit`` (default 8, max 25) FieldHit objects. Each hit
    carries: key, label, category, data_type, source, needs_decode (bool — R1:
    the int value must be decoded before display), fill_note (DATABASE_GUIDE §5
    coverage warning, or null), and similarity (cosine, null for keyword-only
    hits). Use the returned ``key`` values with ``get_values`` or ``compare_schools``.

    Optional filters: ``category`` (e.g. "admissions", "aid", "earnings") and
    ``source`` (e.g. "ipeds", "scorecard", "cds") narrow the search. Set
    ``use_vector=false`` to force keyword-only (useful when the index is being
    rebuilt or for exact-match lookups).
    """
    catalog = await _catalog(ctx)
    hits: list[FieldHit] = await search_fields(
        catalog, query, category=category, source=source, limit=limit, use_vector=use_vector
    )
    return [hit.model_dump(mode="json") for hit in hits]


def main() -> None:
    """Run the server over stdio."""
    mcp.run()


if __name__ == "__main__":
    main()
