"""Process-local carrier for unfinished clarification source registries."""

from __future__ import annotations

from threading import Lock

from app.sources import SourceRegistry


class ParkedSourceStore:
    """Identity-bound, turn-scoped runtime state; never checkpoint serialized."""

    def __init__(self) -> None:
        self._items: dict[tuple[str, str, str | None], SourceRegistry] = {}
        self._lock = Lock()

    @staticmethod
    def _key(session_id: str, message_id: str, user_id: str | None) -> tuple[str, str, str | None]:
        return session_id, message_id, user_id

    def park(
        self, session_id: str, message_id: str, user_id: str | None, registry: SourceRegistry
    ) -> None:
        with self._lock:
            self._items[self._key(session_id, message_id, user_id)] = registry.fork()

    def restore(
        self, session_id: str, message_id: str, user_id: str | None
    ) -> SourceRegistry | None:
        with self._lock:
            registry = self._items.get(self._key(session_id, message_id, user_id))
            return registry.fork() if registry is not None else None

    def clear(self, session_id: str, message_id: str, user_id: str | None) -> None:
        with self._lock:
            self._items.pop(self._key(session_id, message_id, user_id), None)

    def clear_session(self, session_id: str) -> None:
        with self._lock:
            self._items = {
                key: value for key, value in self._items.items() if key[0] != session_id
            }
