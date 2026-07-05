"""Shared helpers for the MVP3 workspace HTTP routes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request

from api.deps import EnvelopeError
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import WorkspaceNotFoundError, WorkspaceValidationError


def runtime_parts(request: Request) -> tuple[Any, Any, Any, WorkspaceEventBus]:
    """Return the explicit runtime pieces the workspace service functions need."""
    runtime = request.app.state.runtime
    event_bus = runtime.deps.workspace_events
    if event_bus is None:
        raise EnvelopeError(500, "Workspace events are not available.")
    return (
        runtime.app_pool,
        runtime.deps.catalog,
        runtime.deps.workspace_seeding_template,
        event_bus,
    )


async def map_workspace_errors[T](call: Callable[[], Awaitable[T]]) -> T:
    """Map service-layer workspace errors to the API envelope."""
    try:
        return await call()
    except WorkspaceNotFoundError as exc:
        raise EnvelopeError(404, "Workspace item not found.") from exc
    except WorkspaceValidationError as exc:
        message = str(exc) or "Workspace validation failed."
        status = 409 if "already active" in message else 422
        raise EnvelopeError(status, message) from exc
