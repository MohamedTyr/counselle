"""Runtime wiring pins for the MVP3 workspace foundation."""

from types import SimpleNamespace

import pytest

import app.deps as deps_mod
from app.workspace.changes import WorkspaceEventBus


class _FakePool:
    async def close(self) -> None:
        return None


async def test_build_runtime_creates_workspace_bus_and_preloads_seed_asset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded_assets: list[str] = []
    created_pools: list[str | None] = []

    async def create_pool(*, dsn: str | None = None) -> _FakePool:
        created_pools.append(dsn)
        return _FakePool()

    class Catalog:
        @classmethod
        async def load(cls, pool: _FakePool) -> str:
            return "catalog"

    async def build_checkpointer(settings: object) -> str:
        return "checkpointer"

    def load_yaml_asset(name: str) -> dict[str, object]:
        loaded_assets.append(name)
        return {
            "tasks": [
                {
                    "title": "Complete the Common App sections for this school",
                    "category": "form",
                    "priority": "high",
                }
            ],
            "essays": [
                {
                    "title": "Supplemental essay",
                    "essay_type": "Supplement",
                    "status": "Not started",
                }
            ],
        }

    monkeypatch.setattr(deps_mod, "create_pool", create_pool)
    monkeypatch.setattr(deps_mod, "Catalog", Catalog)
    monkeypatch.setattr(deps_mod, "build_checkpointer", build_checkpointer)
    monkeypatch.setattr(deps_mod, "build_graph", lambda checkpointer, deps: "graph")
    monkeypatch.setattr(deps_mod, "make_tool_deps", lambda settings, catalog: "tool-deps")
    monkeypatch.setattr(deps_mod, "build_mcp_toolset", lambda settings: "toolset")
    monkeypatch.setattr(deps_mod, "load_yaml_asset", load_yaml_asset)

    runtime = await deps_mod.build_runtime(
        SimpleNamespace(db_app_dsn="postgresql://app", workspace_event_queue_size=7)
    )

    assert loaded_assets == ["workspace_seeding"]
    assert created_pools == [None, "postgresql://app"]
    assert isinstance(runtime.deps.workspace_events, WorkspaceEventBus)
    assert runtime.deps.workspace_events.queue_size == 7
    assert runtime.deps.workspace_seeding_template is not None
    assert runtime.deps.workspace_seeding_template.essays[0].essay_type == "Supplement"
