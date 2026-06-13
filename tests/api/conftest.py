"""Shared fixtures for the protocol integration suite (Phase 5 Slice D).

Strategy
--------
The tests run against the REAL FastAPI app (including its lifespan), the live
Postgres DB (``counselle_ro`` + ``counselle_app`` roles), but with:

- FunctionModel injected via ``AppDeps.model_factory`` — zero Gemini calls.
- InMemorySaver for the checkpointer — no Postgres checkpoint rows to clean up
  for most tests (durability tests live in tests/app/test_durability.py).
- ``mcp_toolset=None`` — no counselle-db MCP stdio child.
- ``build_temporal_context`` and ``build_system_prompt`` patched (same hermetic
  patch as tests/app/test_run_turn.py) — no RO DB call in prepare.

The ``live_app`` fixture returns a ``TestClient``-ready FastAPI app whose
``app.state.runtime`` is the test runtime.  Tests that need async concurrent
requests (test 5: concurrent 409) use ``httpx.AsyncClient`` after running the
lifespan manually via ``app.router.lifespan_context``.

All tests in this file are marked ``@pytest.mark.live_db`` — the live Postgres
container must be up.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

import pytest
import pytest_asyncio
from fastapi import FastAPI
from langgraph.checkpoint.memory import InMemorySaver
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, DeltaToolCalls, FunctionModel

import app.agent_node
import app.graph
from api.context import install_middleware
from api.routes import sessions as session_routes
from api.routes import system as system_routes
from app.deps import Runtime, build_runtime
from app.graph import build_graph
from app.state import TemporalContext
from app.turns import TurnRegistry
from config.settings import get_settings
from domain.season import Season

# ---------------------------------------------------------------------------
# Hermetic fixtures (same as test_run_turn.py)
# ---------------------------------------------------------------------------

_TEMPORAL = TemporalContext(
    today="2026-06-10",
    season=Season(
        phase="exploration",
        description="Rising seniors research schools.",
        entering_class="Fall 2027",
        cycle_note="It is the exploration phase for the class entering Fall 2027.",
    ),
    data_calendar=[],
    context="Today is 2026-06-10.",
)


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch prepare's DB call and prompt builder — same as test_run_turn.py."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda ctx: "Test counselor.")


# ---------------------------------------------------------------------------
# FunctionModel helpers (copied verbatim from tests/app/test_run_turn.py)
# ---------------------------------------------------------------------------


def _fn_model(
    fn: Any,
) -> FunctionModel:
    """FunctionModel with stream variant — the node's run_stream_events requires it."""

    async def stream(
        messages: list[ModelMessage], info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls]:
        response = fn(messages, info)
        for index, part in enumerate(response.parts):
            if isinstance(part, TextPart):
                yield part.content
            else:
                # ToolCallPart — forward as DeltaToolCall
                yield {
                    index: DeltaToolCall(
                        name=part.tool_name,
                        json_args=part.args_as_json_str(),
                    )
                }

    return FunctionModel(fn, stream_function=stream)


def simple_text_model(text: str = "Test response.") -> FunctionModel:
    """A FunctionModel that always returns a fixed text reply."""

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(text)])

    return _fn_model(fn)


# ---------------------------------------------------------------------------
# Fake stub objects (match test_routes_unit.py pattern)
# ---------------------------------------------------------------------------


class _FakeReconciler:
    last_run: str | None = None
    last_result: dict[str, int] | None = None
    last_error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "last_run": self.last_run,
            "last_result": self.last_result,
            "last_error": self.last_error,
        }


class _FakeSupervisor:
    """No-op MCP supervisor: status is always 'ok', no background task."""

    def start(self) -> None:
        pass

    async def aclose(self) -> None:
        pass

    def status(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "consecutive_failures": 0,
            "restarts": 0,
            "last_probe_at": None,
            "last_error": None,
        }


# ---------------------------------------------------------------------------
# Test Runtime factory
# ---------------------------------------------------------------------------


async def _build_test_runtime(model_factory: Any = None) -> tuple[Runtime, Runtime]:
    """Return (test_runtime, orig_runtime) — caller must close orig_runtime."""
    settings = get_settings()
    orig = await build_runtime(settings)

    test_deps = replace(
        orig.deps,
        mcp_toolset=None,  # no MCP stdio child in tests
        model_factory=model_factory or (lambda: simple_text_model()),
    )
    # InMemorySaver keeps tests independent (no checkpoint rows to clean up)
    test_checkpointer = InMemorySaver()
    test_graph = build_graph(test_checkpointer, test_deps)

    test_runtime = Runtime(
        deps=test_deps,
        graph=test_graph,
        checkpointer=test_checkpointer,
        ro_pool=orig.ro_pool,
        app_pool=orig.app_pool,
    )
    return test_runtime, orig


# ---------------------------------------------------------------------------
# App factory for integration tests
# ---------------------------------------------------------------------------


def _build_live_app(runtime: Runtime, run_turn_fn: Any = None) -> FastAPI:
    """Build a FastAPI test app with the given runtime injected on app.state.

    No lifespan is wired here — the runtime is already built; the app state
    is injected directly (the same pattern test_routes_unit.py uses).
    ``run_turn_fn`` injects a fake turn generator into the registry (B2 seam).
    """
    settings = get_settings()
    app = FastAPI(title="Counselle-Test")
    install_middleware(app, settings)
    app.include_router(session_routes.router, prefix="/v1")
    app.include_router(system_routes.router, prefix="/v1")

    app.state.settings = settings
    app.state.runtime = runtime
    app.state.reconciler = _FakeReconciler()
    app.state.mcp_supervisor = _FakeSupervisor()
    app.state.turn_registry = TurnRegistry(
        deps=runtime.deps, graph=runtime.graph, settings=settings, run_turn_fn=run_turn_fn
    )
    return app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="function")
async def test_runtime() -> AsyncIterator[Runtime]:
    """A live runtime with FunctionModel injection and InMemorySaver."""
    rt, orig = await _build_test_runtime()
    try:
        yield rt
    finally:
        await orig.aclose()


@pytest_asyncio.fixture(scope="function")
async def live_app(test_runtime: Runtime) -> AsyncIterator[FastAPI]:
    """A FastAPI app with the test runtime injected (no lifespan needed)."""
    yield _build_live_app(test_runtime)


# ---------------------------------------------------------------------------
# Cleanup helpers
# ---------------------------------------------------------------------------


async def delete_session(pool: Any, session_id: str) -> None:
    """Remove a test session row from counselle.sessions."""
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM counselle.sessions WHERE session_id = $1",
            session_id,
        )
