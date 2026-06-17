"""Tests for app/chat_deletion.cancel_and_drop_threads (audit H3).

The shared deletion primitive: cancel the live turn first (logged-and-tolerated
on failure), then drop each session's checkpoint thread, returning the sids whose
``adelete_thread`` FAILED. Every sid must be attempted (no early break), and a
``registry.cancel`` failure must not stop the thread drop nor mark the sid failed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from app.chat_deletion import cancel_and_drop_threads

if TYPE_CHECKING:
    from app.turns import TurnRegistry


class _FakeRegistry:
    """Records cancel calls; optionally raises for chosen sids."""

    def __init__(self, raise_on: set[str] | None = None) -> None:
        self.cancelled: list[str] = []
        self._raise_on = raise_on or set()

    async def cancel(self, sid: str) -> str:
        self.cancelled.append(sid)
        if sid in self._raise_on:
            raise RuntimeError("cancel blew up")
        return "cancelled"


class _FakeCheckpointer:
    """Records adelete_thread calls; raises for chosen sids."""

    def __init__(self, raise_on: set[str] | None = None) -> None:
        self.deleted: list[str] = []
        self._raise_on = raise_on or set()

    async def adelete_thread(self, sid: str) -> None:
        self.deleted.append(sid)
        if sid in self._raise_on:
            raise RuntimeError("checkpoint delete blew up")


async def test_returns_empty_when_all_succeed() -> None:
    registry = _FakeRegistry()
    checkpointer = _FakeCheckpointer()

    failed = await cancel_and_drop_threads(
        cast("TurnRegistry", registry), checkpointer, ["s1", "s2", "s3"]
    )

    assert failed == []
    assert registry.cancelled == ["s1", "s2", "s3"]
    assert checkpointer.deleted == ["s1", "s2", "s3"]


async def test_returns_failed_sids_and_attempts_every_sid() -> None:
    registry = _FakeRegistry()
    # s2's thread-delete raises; s1 and s3 succeed.
    checkpointer = _FakeCheckpointer(raise_on={"s2"})

    failed = await cancel_and_drop_threads(
        cast("TurnRegistry", registry), checkpointer, ["s1", "s2", "s3"]
    )

    # Only the failing sid is reported.
    assert failed == ["s2"]
    # No early break — every sid was attempted for both cancel and drop.
    assert registry.cancelled == ["s1", "s2", "s3"]
    assert checkpointer.deleted == ["s1", "s2", "s3"]


async def test_multiple_failures_all_reported() -> None:
    registry = _FakeRegistry()
    checkpointer = _FakeCheckpointer(raise_on={"s1", "s3"})

    failed = await cancel_and_drop_threads(
        cast("TurnRegistry", registry), checkpointer, ["s1", "s2", "s3"]
    )

    assert failed == ["s1", "s3"]
    assert checkpointer.deleted == ["s1", "s2", "s3"]


async def test_cancel_failure_is_logged_and_tolerated() -> None:
    # registry.cancel raises for s1, but the thread drop still runs and succeeds.
    registry = _FakeRegistry(raise_on={"s1"})
    checkpointer = _FakeCheckpointer()

    failed = await cancel_and_drop_threads(
        cast("TurnRegistry", registry), checkpointer, ["s1", "s2"]
    )

    # A cancel failure does NOT add to failed and does NOT stop the thread drop.
    assert failed == []
    assert registry.cancelled == ["s1", "s2"]
    assert checkpointer.deleted == ["s1", "s2"]
