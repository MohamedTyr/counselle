"""Runtime wiring pins for the MVP3 workspace foundation."""

from types import SimpleNamespace

import pytest

import app.deps as deps_mod
from app.workspace.changes import WorkspaceEventBus


class _FakePool:
    async def close(self) -> None:
        return None


async def test_build_runtime_creates_workspace_bus_without_seed_asset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created_pools: list[tuple[str | None, object | None]] = []

    async def create_pool(
        *, dsn: str | None = None, settings: object | None = None
    ) -> _FakePool:
        created_pools.append((dsn, settings))
        return _FakePool()

    class Catalog:
        @classmethod
        async def load(cls, pool: _FakePool, *, settings: object) -> str:
            return "catalog"

    async def build_checkpointer(settings: object) -> str:
        return "checkpointer"

    monkeypatch.setattr(deps_mod, "create_pool", create_pool)
    monkeypatch.setattr(deps_mod, "Catalog", Catalog)
    monkeypatch.setattr(deps_mod, "build_checkpointer", build_checkpointer)
    monkeypatch.setattr(deps_mod, "build_graph", lambda checkpointer, deps: "graph")
    monkeypatch.setattr(deps_mod, "make_tool_deps", lambda settings, catalog: "tool-deps")
    monkeypatch.setattr(deps_mod, "build_mcp_toolset", lambda settings: "toolset")

    settings = SimpleNamespace(
        db_app_dsn="postgresql://app",
        workspace_event_queue_size=7,
        cds_data_enabled=True,
        db_pipeline_dsn=None,
    )
    runtime = await deps_mod.build_runtime(settings)

    assert created_pools == [(None, settings), ("postgresql://app", settings)]
    assert isinstance(runtime.deps.workspace_events, WorkspaceEventBus)
    assert runtime.deps.workspace_events.queue_size == 7
    assert not hasattr(runtime.deps, "workspace_seeding_template")
