"""Shared chat/account deletion primitive (audit H3).

Cancel any in-flight turn FIRST (a live task must not checkpoint after
``adelete_thread``), then drop each session's checkpoint thread. Returns the
session ids whose ``adelete_thread`` FAILED so the caller can abort-and-signal
(rows intact, retryable) — the ``me.py`` honesty contract, now owned in one
place and reachable by every route without a cross-route private import.

Cancel failures are logged-and-tolerated (``registry.cancel`` awaits the task +
persists its partial, so a cancel slip is not a data-survival risk); a failed
thread-delete means checkpoints survive and the caller must abort the row
deletion.
"""

from __future__ import annotations

from typing import Any

import structlog

from app.turns import TurnRegistry

logger = structlog.get_logger(__name__)


async def cancel_and_drop_threads(
    registry: TurnRegistry, checkpointer: Any, session_ids: list[str]
) -> list[str]:
    """Registry-cancel any live turn, then drop each session's checkpoint thread.

    ``checkpointer`` is the LangGraph saver (``AsyncPostgresSaver | MemorySaver``)
    that owns ``adelete_thread`` — the compiled graph has no such method, so the
    caller passes the checkpointer explicitly. Returns the session ids whose
    ``adelete_thread`` FAILED; every sid is attempted (no early break).
    """
    failed: list[str] = []
    for sid in session_ids:
        try:
            await registry.cancel(sid)
        except Exception:
            logger.exception("registry cancel failed during delete", session_id=sid)
        try:
            await checkpointer.adelete_thread(sid)
        except Exception:
            logger.exception("adelete_thread failed during delete", session_id=sid)
            failed.append(sid)
    return failed
