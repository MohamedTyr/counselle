"""The shared app deps container + the production runtime factory (Slice F).

:class:`AppDeps` extends :class:`app.graph.GraphDeps` with everything the agent
node needs beyond state: the settings surface, the per-app Tavily tool deps,
and the **model factory seam** — unit tests inject ``FunctionModel``/
``TestModel`` here; ``None`` means the real Gemini via
:func:`app.agent_node.default_model_factory` (notes-p4-apis §1).

:func:`build_runtime` is the one production wiring path (chat CLI now, the
FastAPI lifespan in Phase 5): RO pool + catalog, app pool, durable checkpointer,
compiled graph — and one ``aclose()`` that puts it all away.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import asyncpg
import structlog
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic_ai.models import Model

from app.checkpointer import build_checkpointer
from app.graph import GraphDeps, build_graph
from app.run_handle import RunHandleStore
from app.toolset import ToolDeps, make_tool_deps
from app.workspace.changes import WorkspaceEventBus
from app.workspace.document_summary import DocumentSummaryGenerator, make_document_summary_generator
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool

logger = structlog.get_logger(__name__)


@dataclass
class AppDeps(GraphDeps):
    """GraphDeps + the agent node's seams (settings, tools, model factory).

    Every extra field defaults to ``None``; the agent node falls back to the
    production wiring (``get_settings()`` / ``make_tool_deps`` / the real
    GoogleModel) when a seam is unset.
    """

    settings: Any = None  # config.settings.Settings (Any: tests pass a namespace)
    run_handles: RunHandleStore | None = field(default_factory=RunHandleStore)
    tool_deps: ToolDeps | None = None
    model_factory: Callable[[], Model] | None = None
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
    # The third DSN (plan §C3): cds_library_app writer pool. Under school-data-v3
    # this drives the (Phase 1) facts crawler; the parked CDS admin pipeline it
    # used to drive exclusively still reads it too (mutually exclusive by
    # design — see config.settings.cds_worker_enabled). None when
    # COUNSELLE_DB_PIPELINE_DSN is unset — the app boots fine without it.
    pipeline_pool: asyncpg.Pool | None = None

    async def aclose(self) -> None:
        """Close pools and the checkpointer connection (idempotent enough for exit)."""
        await self.ro_pool.close()
        await self.app_pool.close()
        if self.pipeline_pool is not None:
            await self.pipeline_pool.close()
        if isinstance(self.checkpointer, AsyncPostgresSaver):
            await self.checkpointer.conn.close()


async def build_runtime(settings: Any = None) -> Runtime:
    """Production wiring: pools, catalog, checkpointer, MCP toolset, graph."""
    settings = settings or get_settings()
    ro_pool = await create_pool(settings=settings)
    try:
        catalog = await Catalog.load(ro_pool, settings=settings)
        tool_deps = make_tool_deps(settings, catalog)
        app_pool = await create_pool(dsn=settings.db_app_dsn, settings=settings)
    except BaseException:
        await ro_pool.close()
        raise
    pipeline_pool: asyncpg.Pool | None = None
    if settings.db_pipeline_dsn:
        try:
            pipeline_pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
        except asyncio.CancelledError:
            # Not a connection failure to degrade from — close the pools
            # already open above before propagating the cancellation.
            await ro_pool.close()
            await app_pool.close()
            raise
        except Exception:
            # Degrade, don't take down the whole app: this DSN only backs the
            # superuser-only CDS admin surface, which already 503s cleanly
            # when pipeline_pool is None (mirrors the DSN-unset posture).
            logger.exception("cds_pipeline_pool_unreachable")
            pipeline_pool = None
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
