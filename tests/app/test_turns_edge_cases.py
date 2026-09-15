"""Additional hermetic state-machine coverage for :mod:`app.turns`.

These tests deliberately use the registry's injected ``run_turn_fn`` seam so
the lifecycle is exercised without a database, model provider, or network.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

import app.turns as turns_mod
from app.parked_sources import ParkedSourceStore
from app.run_turn import _USER_SAFE_ERROR
from domain.events import Event, ev_delta, ev_error, ev_meta
from domain.response_mode import ResponseMode
from tests.app.test_run_turn import FakeSettings


class _Graph:
    def __init__(self, values: dict[str, Any] | None = None) -> None:
        self.values = values or {}
        self.updates: list[dict[str, Any]] = []

    async def aget_state(self, config: dict[str, Any]) -> Any:
        return SimpleNamespace(values=self.values, tasks=[])

    async def aupdate_state(
        self, config: dict[str, Any], update: dict[str, Any], **kwargs: Any
    ) -> None:
        self.updates.append(update)
        self.values = {**self.values, **update}


def _settings(**overrides: Any) -> Any:
    settings = FakeSettings()
    for name, value in overrides.items():
        setattr(settings, name, value)
    return settings


def _registry(
    run_turn_fn: Any,
    *,
    graph: _Graph | None = None,
    settings: Any | None = None,
) -> tuple[turns_mod.TurnRegistry, _Graph]:
    state = graph or _Graph()
    deps = SimpleNamespace(
        app_pool=None,
        parked_sources=ParkedSourceStore(),
        run_handles=None,
    )
    return (
        turns_mod.TurnRegistry(
            deps=deps,
            graph=state,
            settings=settings or _settings(),
            run_turn_fn=run_turn_fn,
        ),
        state,
    )


async def _collect(stream: AsyncIterator[tuple[Event, int]]) -> list[tuple[Event, int]]:
    return [item async for item in stream]


def _meta(session_id: str) -> Event:
    return ev_meta(
        "trace-1",
        session_id,
        "google-vertex:test",
        "message-1",
        "user-message-1",
        ResponseMode.QUICK.value,
    )


@pytest.mark.asyncio
async def test_cancel_before_meta_is_terminal_and_idempotent() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def blocked(*args: Any, **kwargs: Any) -> AsyncIterator[Event]:
        started.set()
        await release.wait()
        if False:
            yield ev_delta("unreachable")

    registry, _ = _registry(blocked)
    session_id = str(uuid4())
    handle = await registry.start(session_id, "hello")
    await started.wait()

    assert await registry.cancel(session_id) == "cancelled"
    events = await _collect(handle)
    assert [event.type for event, _ in events] == ["done"]
    assert events[-1][0].data["status"] == "cancelled"
    assert not registry.is_generating(session_id)
    # The finalized turn is gone; a racing second stop is an idle no-op.
    assert await registry.cancel(session_id) == "idle"


@pytest.mark.asyncio
async def test_timeout_cleans_up_detached_turn_with_error_not_cancelled() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def blocked(*args: Any, **kwargs: Any) -> AsyncIterator[Event]:
        started.set()
        await release.wait()
        if False:
            yield ev_delta("unreachable")

    registry, _ = _registry(blocked, settings=_settings(agent_turn_timeout_s=0.01))
    session_id = str(uuid4())
    handle = await registry.start(session_id, "hello")
    await started.wait()
    events = await asyncio.wait_for(_collect(handle), timeout=1)

    assert events[-1][0].type == "error"
    assert events[-1][0].data["message"] == turns_mod._USER_SAFE_TIMEOUT
    assert not any(event.type == "done" for event, _ in events)
    assert not registry.is_generating(session_id)
    assert await registry.cancel(session_id) == "idle"


@pytest.mark.asyncio
async def test_provider_error_finalizes_and_late_attach_has_no_active_turn() -> None:
    async def failing(*args: Any, **kwargs: Any) -> AsyncIterator[Event]:
        raise RuntimeError("provider failed")
        yield ev_delta("unreachable")

    registry, _ = _registry(failing)
    session_id = str(uuid4())
    handle = await registry.start(session_id, "hello")
    events = await asyncio.wait_for(_collect(handle), timeout=1)

    assert events[-1][0] == ev_error(_USER_SAFE_ERROR, "")
    assert not registry.is_generating(session_id)
    with pytest.raises(turns_mod.NoActiveTurn):
        registry.attach(session_id)


@pytest.mark.asyncio
async def test_unknown_legacy_event_is_replayed_and_safety_error_closes_stream() -> None:
    async def legacy(*args: Any, **kwargs: Any) -> AsyncIterator[Event]:
        yield _meta(args[0])
        # Older producers may add event kinds the registry does not interpret.
        # ``model_construct`` represents a payload that an older producer
        # could have placed on the internal seam before the current Event
        # model's Literal validation existed.
        yield Event.model_construct(type="legacy_notice", data={"message": "old producer"})

    registry, _ = _registry(legacy)
    session_id = str(uuid4())
    events = await asyncio.wait_for(_collect(await registry.start(session_id, "hello")), timeout=1)

    assert [event.type for event, _ in events] == ["meta", "legacy_notice", "error"]
    assert events[1][0].data == {"message": "old producer"}
    assert events[-1][0].data["message"] == _USER_SAFE_ERROR


@pytest.mark.asyncio
async def test_foreign_last_event_cursor_replays_current_detached_turn() -> None:
    release = asyncio.Event()
    started = asyncio.Event()

    async def stream(*args: Any, **kwargs: Any) -> AsyncIterator[Event]:
        session_id = args[0]
        yield _meta(session_id)
        started.set()
        await release.wait()

    registry, _ = _registry(stream)
    session_id = str(uuid4())
    starter = await registry.start(session_id, "hello")
    await started.wait()
    reattached = registry.attach(session_id, last_event_id=999)
    replay_task = asyncio.create_task(_collect(reattached))
    await asyncio.sleep(0)
    release.set()
    starter_events, replay_events = await asyncio.gather(_collect(starter), replay_task)

    assert [event.type for event, _ in replay_events] == ["meta", "error"]
    assert [(event.type, seq) for event, seq in replay_events] == [
        (event.type, seq) for event, seq in starter_events
    ]


def test_ring_buffer_budget_evicts_heads_and_refunds_on_close() -> None:
    refunded: list[int] = []
    charged = 0

    def charge(size: int) -> int:
        nonlocal charged
        charged += size
        return 0 if charged <= 300 else -1

    def refund(size: int) -> None:
        nonlocal charged
        charged -= size
        refunded.append(size)

    buffer = turns_mod._RingBuffer(maxsize=10, on_charge=charge, on_refund=refund)
    buffer.append(ev_delta("first"))
    buffer.append(ev_delta("second"))

    assert buffer.base == 1
    assert buffer.next_seq == 2
    assert buffer.get(1).data == {"text": "second"}
    buffer.close()
    buffer.drop_all()
    assert charged == 0
    assert len(refunded) == 2
