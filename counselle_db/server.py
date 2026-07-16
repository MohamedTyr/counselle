"""Thin MCP shell exposing exactly four CDS Library tools."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import wraps
from typing import Any

import structlog
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.session import ServerSession

from config.logging import setup_logging
from config.settings import get_db_child_settings
from counselle_db import service
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool

logger = structlog.get_logger(__name__)


@dataclass
class AppState:
    catalog: Catalog


@asynccontextmanager
async def _lifespan(_server: FastMCP) -> AsyncIterator[AppState]:
    settings = get_db_child_settings()
    setup_logging(settings.log_level)
    pool = await create_pool(settings=settings)
    try:
        yield AppState(catalog=await Catalog.load(pool, settings=settings))
    finally:
        await pool.close()


mcp = FastMCP("counselle-db", lifespan=_lifespan)
AppContext = Context[ServerSession, AppState]


async def _catalog(ctx: AppContext) -> Catalog:
    catalog = ctx.request_context.lifespan_context.catalog
    await catalog.maybe_refresh()
    return catalog


def _error(message: str) -> dict[str, Any]:
    lowered = message.lower()
    if any(
        word in lowered
        for word in ("postgresql://", "password", "api_key", "secret", "token", "dsn")
    ):
        message = "database tool failed without a shareable error message"
    return {
        "error": "tool_error",
        "root_cause": message,
        "safe_retry": "Adjust the arguments and retry once if data is still needed.",
        "stop_condition": "If unavailable or outside the contract, say so instead of retrying.",
    }


def tool_errors(fn: Any) -> Any:
    @wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return await fn(*args, **kwargs)
        except service.ServiceError as exc:
            return _error(str(exc))
        except Exception:
            logger.warning("mcp_tool_unexpected_error", tool=fn.__name__, exc_info=True)
            return _error("database tool failed without a shareable error message")

    return wrapper


@mcp.tool()
@tool_errors
async def resolve_school(query: str, ctx: AppContext) -> dict[str, Any]:
    """Resolve a school name, abbreviation, alias, or UNITID to one school.

    Input: ``query`` — free text or a UNITID string.

    Success returns exactly one of three ``status`` values:
    - ``match`` — one school, plus its live coverage block (the selected
      edition's raw opening year and deterministic ``selected_edition`` label,
      currentness, and which domain ids currently have a usable packet). Copy
      ``selected_edition`` verbatim; never derive an edition label from the raw
      year. Call ``get_domain`` only for a domain id this block lists.
    - ``candidates`` — more than one campus matched; ask which campus the
      student means, then resolve again with a more specific query.
    - ``not_found`` — no school in the database matches; say so honestly and
      route to web/.edu search instead of inventing a school.

    Error returns ``error: tool_error`` with safe retry/stop guidance. On
    ``tool_error``, retry once with a corrected query, or fall back to web
    search if the school is plausibly real but unresolvable by name.
    """
    return (await service.resolve_school(await _catalog(ctx), query)).model_dump(mode="json")


@mcp.tool()
@tool_errors
async def get_school_profile(
    unitid: int, ctx: AppContext, groups: list[str] | None = None
) -> dict[str, Any]:
    """Read a school's stable identity profile: contact, classification, and
    official links — never a current metric.

    Input: ``unitid`` (from ``resolve_school``) and optional ``groups`` — a
    subset of the group names the profile itself defines; omit to read every
    group. Group names are data-derived, never a fixed enum — an unknown
    group fails with the actual valid group list for this school; retry with
    one of those.

    Success returns the school and requested groups (there is no synthetic
    success status). Every field returned carries the profile's own snapshot vintage and a
    per-field provenance receipt; it is identity data, not a current metric,
    and always needs the ``profile_snapshot`` caveat when you state it. Error
    returns ``error: tool_error``; correct the UNITID/group from
    ``resolve_school`` or stop and say the profile field is unavailable.
    """
    return (await service.get_school_profile(await _catalog(ctx), unitid, groups)).model_dump(
        mode="json"
    )


@mcp.tool()
@tool_errors
async def get_domain(unitid: int, domain_id: str, ctx: AppContext) -> dict[str, Any]:
    """Read one CDS domain for a school — the only metric read path.

    Input: ``unitid`` (from ``resolve_school``) and ``domain_id`` — call
    ``resolve_school`` first and use only a domain id its coverage block
    lists as usable for this school.

    Success returns the domain payload (there is no synthetic success
    status), including every metric configured for the domain in the current manifest
    as a qualified ``domain_id.metric_id`` ref, with its display value and
    page-level citation when verified, or an honest unavailable reason
    otherwise (not yet extracted, in conflict, or absent from this school's
    CDS template edition). ``availability.verified`` counts every verified
    source assertion, including evidence-backed source absences;
    ``availability.available`` counts the verified reported values usable in
    an answer. Never estimate either count from the row list.

    An invalid ``domain_id`` fails with the currently valid domain ids from
    the loaded manifest; retry with one of those. When the school has no
    active document or accepted packet for this domain, say so honestly and
    fall back to official web/.edu search.

    Error returns ``error: tool_error``; correct the UNITID/domain from the
    resolution coverage block or stop rather than inventing another path.
    """
    return (await service.get_domain(await _catalog(ctx), unitid, domain_id)).model_dump(
        mode="json"
    )


@mcp.tool()
@tool_errors
async def query_database(
    sql: str, ctx: AppContext, params: list[Any] | None = None
) -> dict[str, Any]:
    """Run one guarded, read-only SQL read over the five reader views, for a
    shape no typed tool covers: cross-school candidate selection, aggregates,
    or coverage/manifest detail.

    Input: ``sql`` — a single parameterized ``SELECT``/``WITH`` statement
    using ``$1..$n`` placeholders only — and optional ``params``.

    Success returns ``columns``, ``rows``, ``row_count``, ``truncated``, and
    ``as_of`` (there is no synthetic success status). Rows are raw and bypass
    the typed reading rules and citations entirely:
    never present a raw row as a cited student-facing value. Re-fetch any
    named final value through ``get_school_profile``/``get_domain`` before
    stating it, and state the covered/total denominator on any aggregate.

    Error returns ``error: tool_error``. On failure, the error explains the
    rejected shape (not a single bounded statement, or reaching outside the
    five views); rewrite the query rather than retry it verbatim.
    """
    return (await service.query_database(await _catalog(ctx), sql, params)).model_dump(mode="json")


if __name__ == "__main__":
    mcp.run()
