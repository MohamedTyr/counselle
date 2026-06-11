"""The shared app deps container + the production runtime factory (Slice F).

:class:`AppDeps` extends :class:`app.graph.GraphDeps` with everything the agent
node needs beyond state: the settings surface, the per-app Tavily tool deps,
the always-on counselle-db MCP toolset, and the **model factory seam** — unit
tests inject ``FunctionModel``/``TestModel`` here; ``None`` means the real
Gemini via :func:`app.agent_node.default_model_factory` (notes-p4-apis §1).

:func:`build_runtime` is the one production wiring path (chat CLI now, the
FastAPI lifespan in Phase 5): RO pool + catalog, app pool, durable checkpointer,
compiled graph — and one ``aclose()`` that puts it all away.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import asyncpg
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models import Model

from app.checkpointer import build_checkpointer
from app.graph import GraphDeps, build_graph
from app.toolset import ToolDeps, build_mcp_toolset, make_tool_deps
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool


@dataclass
class AppDeps(GraphDeps):
    """GraphDeps + the agent node's seams (settings, tools, model factory).

    Every extra field defaults to ``None``; the agent node falls back to the
    production wiring (``get_settings()`` / ``make_tool_deps`` / the real
    GoogleModel) when a seam is unset. ``mcp_toolset=None`` mounts no MCP
    toolset at all — what unit tests want (no stdio child).

    ``on_failure`` is an optional zero-arg hook called (guarded, never raises)
    when run_turn's outer exception handler fires — used by the API to kick
    the MCP supervisor for prompt recovery (FIX 3, api/supervision.py).
    """

    settings: Any = None  # config.settings.Settings (Any: tests pass a namespace)
    tool_deps: ToolDeps | None = None
    mcp_toolset: MCPToolset | None = None
    model_factory: Callable[[], Model] | None = None
    on_failure: Callable[[], None] | None = field(default=None)


@dataclass
class Runtime:
    """Everything a live consumer needs, built once and closed once."""

    deps: AppDeps
    graph: Any  # CompiledStateGraph — typed Any to keep langgraph generics out
    checkpointer: Any
    ro_pool: asyncpg.Pool
    app_pool: asyncpg.Pool

    async def aclose(self) -> None:
        """Close pools and the checkpointer connection (idempotent enough for exit)."""
        await self.ro_pool.close()
        await self.app_pool.close()
        if isinstance(self.checkpointer, AsyncPostgresSaver):
            await self.checkpointer.conn.close()


async def build_runtime(settings: Any = None) -> Runtime:
    """Production wiring: pools, catalog, checkpointer, MCP toolset, graph."""
    settings = settings or get_settings()
    ro_pool = await create_pool()
    try:
        catalog = await Catalog.load(ro_pool)
        app_pool = await create_pool(dsn=settings.db_app_dsn)
    except BaseException:
        await ro_pool.close()
        raise
    try:
        checkpointer = await build_checkpointer(settings)
    except BaseException:
        await ro_pool.close()
        await app_pool.close()
        raise
    deps = AppDeps(
        catalog=catalog,
        app_pool=app_pool,
        settings=settings,
        tool_deps=make_tool_deps(settings, catalog),
        mcp_toolset=build_mcp_toolset(settings),
    )
    graph = build_graph(checkpointer, deps)
    return Runtime(
        deps=deps, graph=graph, checkpointer=checkpointer, ro_pool=ro_pool, app_pool=app_pool
    )
