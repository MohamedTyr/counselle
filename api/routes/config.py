"""Runtime config: GET /v1/config (authed) — the home-screen payload (B4, §30).

Wire-contract §3 shape exactly:

    { greeting, season_note, conversation_starters, default_source_config }

- ``greeting`` / ``season_note`` — from ``greeting_templates.yaml`` keyed by the
  same ``admission_season`` machinery the agent uses (``season_calendar.yaml``).
  An unknown phase falls back to the ``default`` entry; ``season_note`` may be
  null/'' (Landing hides the line).
- ``conversation_starters`` — from ``starter_prompts.yaml``.
- ``default_source_config`` — the user's stored preset
  (``user.settings["default_source_config"]``, validated through SourceConfig)
  falling back to ``SourceConfig.defaults_from(settings)``. Emitted in the WIRE
  shape (backend names — §4).
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from api.auth import current_active_user
from api.users_db import UserDB
from app.skills import MAX_SELECTED_SKILLS, user_skill_catalog
from config.settings import load_yaml_asset
from domain.season import SeasonWindow, admission_season
from domain.specs import SourceConfig

router = APIRouter(tags=["config"])
logger = structlog.get_logger(__name__)

_DEFAULT_KEY = "default"


def _season_copy(today: date) -> dict[str, Any]:
    """The greeting + season_note for today's phase (falls back to ``default``)."""
    windows = [SeasonWindow.model_validate(row) for row in load_yaml_asset("season_calendar")]
    phase = admission_season(today, windows).phase
    templates = load_yaml_asset("greeting_templates")
    entry = templates.get(phase) or templates.get(_DEFAULT_KEY) or {}
    return {
        "greeting": entry.get("greeting") or "",
        "season_note": entry.get("season_note") or None,
    }


def _default_source_config(user: UserDB, settings: Any) -> dict[str, Any]:
    """The user's stored preset (validated) or the Settings defaults — wire shape."""
    stored = (user.settings or {}).get("default_source_config")
    if stored is not None:
        try:
            return SourceConfig.model_validate(stored).model_dump(mode="json")
        except ValidationError:
            logger.warning("invalid stored default_source_config — using settings defaults")
    return SourceConfig.defaults_from(settings).model_dump(mode="json")


@router.get("/config")
async def get_config(
    request: Request, user: UserDB = Depends(current_active_user)
) -> JSONResponse:
    """The authed home-screen config (wire-contract §3)."""
    settings = request.app.state.settings
    copy = _season_copy(datetime.now(UTC).date())
    starters = list(load_yaml_asset("starter_prompts") or [])
    return JSONResponse(
        content={
            "greeting": copy["greeting"],
            "season_note": copy["season_note"],
            "conversation_starters": starters,
            "default_source_config": _default_source_config(user, settings),
            "skills": user_skill_catalog(),
            "max_selected_skills": MAX_SELECTED_SKILLS,
        }
    )
