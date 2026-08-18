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

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

import asyncpg
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models import Model

from app.checkpointer import build_checkpointer
from app.graph import GraphDeps, build_graph
from app.run_handle import RunHandleStore
from app.toolset import ToolDeps, build_mcp_toolset, make_tool_deps
from app.workspace.changes import WorkspaceEventBus
from app.workspace.document_summary import DocumentSummaryGenerator, make_document_summary_generator
from config.settings import get_settings
from counselle_db.catalog import Catalog, CatalogSnapshot
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
    run_handles: RunHandleStore | None = field(default_factory=RunHandleStore)
    tool_deps: ToolDeps | None = None
    mcp_toolset: MCPToolset | None = None
    model_factory: Callable[[], Model] | None = None
    on_failure: Callable[[], None] | None = field(default=None)
    workspace_events: WorkspaceEventBus | None = None
    document_summary_generator: DocumentSummaryGenerator | None = None


@dataclass
class Runtime:
    """Everything a live consumer needs, built once and closed once."""

    deps: AppDeps
    graph: Any  # CompiledStateGraph — typed Any to keep langgraph generics out
    checkpointer: Any
    ro_pool: asyncpg.Pool
    app_pool: asyncpg.Pool
    # The third DSN (plan §C3): cds_library_app writer pool for the CDS admin
    # pipeline. None when COUNSELLE_DB_PIPELINE_DSN is unset — the app boots
    # fine without it (mirrors cds_data_enabled's EmptyCatalog fallback).
    pipeline_pool: asyncpg.Pool | None = None

    async def aclose(self) -> None:
        """Close pools and the checkpointer connection (idempotent enough for exit)."""
        await self.ro_pool.close()
        await self.app_pool.close()
        if self.pipeline_pool is not None:
            await self.pipeline_pool.close()
        if isinstance(self.checkpointer, AsyncPostgresSaver):
            await self.checkpointer.conn.close()


class EmptyCatalog:
    """Minimal catalog for temporary demos that intentionally run without CDS data."""

    snapshot: None = None
    school_count = 0
    school_names: Mapping[int, str] = MappingProxyType({})

    async def maybe_refresh(self, *, force: bool = False) -> CatalogSnapshot | None:
        return None

    def school_name(self, unitid: int) -> str | None:
        return None

    def school_domain(self, unitid: int) -> str | None:
        return None

    def resolve_candidates(self, query: str) -> tuple[Any, ...]:
        return ()


async def build_runtime(settings: Any = None) -> Runtime:
    """Production wiring: pools, catalog, checkpointer, MCP toolset, graph."""
    settings = settings or get_settings()
    ro_pool = await create_pool(settings=settings)
    try:
        catalog: Any
        if settings.cds_data_enabled:
            catalog = await Catalog.load(ro_pool, settings=settings)
            tool_deps = make_tool_deps(settings, catalog)
            mcp_toolset = build_mcp_toolset(settings)
        else:
            catalog = EmptyCatalog()
            tool_deps = make_tool_deps(settings, catalog)
            mcp_toolset = None
        app_pool = await create_pool(dsn=settings.db_app_dsn, settings=settings)
    except BaseException:
        await ro_pool.close()
        raise
    try:
        pipeline_pool: asyncpg.Pool | None = None
        if settings.db_pipeline_dsn:
            pipeline_pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    except BaseException:
        await ro_pool.close()
        await app_pool.close()
        raise
    try:
        checkpointer = await build_checkpointer(settings)
    except BaseException:
        await ro_pool.close()
        await app_pool.close()
        if pipeline_pool is not None:
            await pipeline_pool.close()
        raise
    deps = AppDeps(
        catalog=catalog,
        app_pool=app_pool,
        settings=settings,
        run_handles=RunHandleStore(),
        tool_deps=tool_deps,
        mcp_toolset=mcp_toolset,
        workspace_events=WorkspaceEventBus(queue_size=settings.workspace_event_queue_size),
        document_summary_generator=make_document_summary_generator(settings),
    )
    graph = build_graph(checkpointer, deps)
    return Runtime(
        deps=deps,
        graph=graph,
        checkpointer=checkpointer,
        ro_pool=ro_pool,
        app_pool=app_pool,
        pipeline_pool=pipeline_pool,
    )
