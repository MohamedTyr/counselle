"""Read one school's source block into verified prompts (cheap model + code check)."""

from __future__ import annotations

from typing import Any

import structlog
from pydantic import BaseModel

from app.asset_format import render_slots
from config.settings import load_prompt
from domain.supplements import RejectedPrompt, SupplementPrompt, verify_prompts

logger = structlog.get_logger(__name__)


class _Extraction(BaseModel):
    prompts: list[SupplementPrompt]


class ExtractionFailed(RuntimeError):
    """The model call never produced a usable answer; keep the stored prompts."""


async def extract_block(
    settings: Any, heading: str, block: str, *, model: Any = None
) -> tuple[list[SupplementPrompt], list[RejectedPrompt]]:
    """Return the block's prompts that pass ``verify_prompts``, and the ones that did not."""
    from pydantic_ai import Agent

    agent: Agent[None, _Extraction] = Agent(
        model or _model(settings),
        output_type=_Extraction,
        system_prompt=render_slots(
            load_prompt("supplement_extract"), ("cycle",), cycle=settings.supplements_cycle
        ),
    )
    message = f"Heading: {heading}\n\n<block>\n{block}\n</block>"
    last_error: Exception | None = None
    for attempt in range(1, settings.supplements_extract_attempts + 1):
        try:
            result = await agent.run(message)
        except Exception as exc:  # any model/transport failure: retry, then give up
            last_error = exc
            logger.warning("supplement_extract_failed", heading=heading, attempt=attempt)
            continue
        return verify_prompts(result.output.prompts, block)
    raise ExtractionFailed(f"{heading}: {last_error!r}")


def _model(settings: Any) -> Any:
    from app.llm import build_model

    return build_model(
        settings, settings.model_cheap, reasoning_effort=settings.supplements_reasoning_effort
    )
