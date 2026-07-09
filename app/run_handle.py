"""Process-local active-run handles.

The store is intentionally in-memory only. It lets runtime owners find the
currently active PydanticAI run metadata without putting non-serializable
objects into LangGraph state.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class SteeringMessage:
    user_message_id: str
    text: str
    injected: bool = False


@dataclass
class RunHandle:
    session_id: str
    messages_snapshot: list[dict[str, Any]] = field(default_factory=list)
    snapshot_seq: int = 0
    emissions_len_at_snapshot: int = 0
    steering_queue: deque[SteeringMessage] = field(default_factory=deque)
    queued_at_terminal: list[SteeringMessage] = field(default_factory=list)

    def queue_steer(self, message: SteeringMessage) -> None:
        self.steering_queue.append(message)

    def drain_steers(self) -> list[SteeringMessage]:
        messages = list(self.steering_queue)
        self.steering_queue.clear()
        return messages

    def record_snapshot(
        self,
        messages: list[dict[str, Any]],
        *,
        emissions_len: int,
    ) -> None:
        self.messages_snapshot = messages
        self.snapshot_seq += 1
        self.emissions_len_at_snapshot = emissions_len


class RunHandleStore:
    def __init__(self) -> None:
        self._handles: dict[str, RunHandle] = {}

    def register(self, session_id: str) -> RunHandle:
        handle = RunHandle(session_id=session_id)
        self._handles[session_id] = handle
        return handle

    def get(self, session_id: str) -> RunHandle | None:
        return self._handles.get(session_id)

    def unregister(self, session_id: str, handle: RunHandle) -> None:
        if self._handles.get(session_id) is handle:
            del self._handles[session_id]
