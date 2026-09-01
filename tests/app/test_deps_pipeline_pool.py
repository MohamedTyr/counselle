"""W-01 regression pin: an unreachable pipeline DSN degrades, it doesn't take
down the whole app.

Before this fix, ``build_runtime`` re-raised any pipeline-pool creation
failure out of the FastAPI lifespan, so a briefly-unreachable
``COUNSELLE_DB_PIPELINE_DSN`` (network blip, credential rotation, typo'd
port) failed the *entire* API to boot -- no chat, no auth, no workspace --
for a DSN only the superuser-only CDS admin surface ever touches. The fix:
catch the pipeline-pool creation failure specifically and degrade to
``pipeline_pool = None``, the same posture already used when the DSN is
unset (``api/routes/cds_admin.py``'s clean 503).
"""

import asyncio
from types import SimpleNamespace

import pytest

import app.deps as deps_mod


class _FakePool:
    async def close(self) -> None:
        return None


async def test_build_runtime_degrades_when_pipeline_dsn_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def create_pool(*, dsn: str | None = None, settings: object | None = None) -> _FakePool:
        if dsn == "postgresql://pipeline-unreachable":
            # Mirrors what asyncpg.create_pool raises when the port refuses
            # connections (127.0.0.1:59999 in the audit's live repro).
            raise ConnectionRefusedError(111, "Connect call failed")
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
        db_pipeline_dsn="postgresql://pipeline-unreachable",
        cds_data_enabled=True,
        workspace_event_queue_size=7,
    )

    runtime = await deps_mod.build_runtime(settings)

    assert runtime.pipeline_pool is None
    # The RO and app pools must still come up -- only the pipeline pool degrades.
    assert isinstance(runtime.ro_pool, _FakePool)
    assert isinstance(runtime.app_pool, _FakePool)


async def test_build_runtime_still_raises_when_app_pool_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Guards the fix's boundary: only the pipeline pool degrades. A genuine
    failure of the app pool (required, not admin-only) must still fail boot."""

    async def create_pool(*, dsn: str | None = None, settings: object | None = None) -> _FakePool:
        if dsn == "postgresql://app":
            raise ConnectionRefusedError(111, "Connect call failed")
        return _FakePool()

    class Catalog:
        @classmethod
        async def load(cls, pool: _FakePool, *, settings: object) -> str:
            return "catalog"

    monkeypatch.setattr(deps_mod, "create_pool", create_pool)
    monkeypatch.setattr(deps_mod, "Catalog", Catalog)
    monkeypatch.setattr(deps_mod, "make_tool_deps", lambda settings, catalog: "tool-deps")
    monkeypatch.setattr(deps_mod, "build_mcp_toolset", lambda settings: "toolset")

    settings = SimpleNamespace(
        db_app_dsn="postgresql://app",
        db_pipeline_dsn=None,
        cds_data_enabled=True,
        workspace_event_queue_size=7,
    )

    with pytest.raises(ConnectionRefusedError):
        await deps_mod.build_runtime(settings)


async def test_build_runtime_closes_pools_when_pipeline_pool_creation_is_cancelled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """asyncio.CancelledError is a BaseException, not an Exception, on 3.12 --
    the pipeline-pool degrade handler must not swallow it, and the RO/app
    pools opened before it must still be closed rather than leaked."""

    closed: list[str] = []

    class _TrackedPool(_FakePool):
        def __init__(self, name: str) -> None:
            self._name = name

        async def close(self) -> None:
            closed.append(self._name)

    async def create_pool(
        *, dsn: str | None = None, settings: object | None = None
    ) -> _TrackedPool:
        if dsn == "postgresql://pipeline-cancelled":
            raise asyncio.CancelledError
        if dsn == "postgresql://app":
            return _TrackedPool("app")
        return _TrackedPool("ro")

    class Catalog:
        @classmethod
        async def load(cls, pool: _TrackedPool, *, settings: object) -> str:
            return "catalog"

    monkeypatch.setattr(deps_mod, "create_pool", create_pool)
    monkeypatch.setattr(deps_mod, "Catalog", Catalog)
    monkeypatch.setattr(deps_mod, "make_tool_deps", lambda settings, catalog: "tool-deps")
    monkeypatch.setattr(deps_mod, "build_mcp_toolset", lambda settings: "toolset")

    settings = SimpleNamespace(
        db_app_dsn="postgresql://app",
        db_pipeline_dsn="postgresql://pipeline-cancelled",
        cds_data_enabled=True,
        workspace_event_queue_size=7,
    )

    with pytest.raises(asyncio.CancelledError):
        await deps_mod.build_runtime(settings)

    assert closed == ["ro", "app"]
