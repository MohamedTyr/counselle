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
    pool = await create_pool()
    try:
        yield AppState(catalog=await Catalog.load(pool))
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
    """Resolve a school name, alias, or UNITID and return live CDS edition coverage."""
    return (await service.resolve_school(await _catalog(ctx), query)).model_dump(mode="json")


@mcp.tool()
@tool_errors
async def get_school_profile(
    unitid: int, ctx: AppContext, groups: list[str] | None = None
) -> dict[str, Any]:
    """Read stable identity-profile groups with stored provenance and snapshot caveats."""
    return (await service.get_school_profile(await _catalog(ctx), unitid, groups)).model_dump(
        mode="json"
    )


@mcp.tool()
@tool_errors
async def get_domain(unitid: int, domain_id: str, ctx: AppContext) -> dict[str, Any]:
    """Read one CDS domain from the newest selected edition through strict packet rules."""
    return (await service.get_domain(await _catalog(ctx), unitid, domain_id)).model_dump(
        mode="json"
    )


@mcp.tool()
@tool_errors
async def query_database(
    sql: str, ctx: AppContext, params: list[Any] | None = None
) -> dict[str, Any]:
    """Run bounded candidate or aggregate analysis on the five schema-qualified reader views."""
    return (await service.query_database(await _catalog(ctx), sql, params)).model_dump(mode="json")


if __name__ == "__main__":
    mcp.run()
