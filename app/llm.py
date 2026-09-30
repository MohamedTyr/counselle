"""The one place a live model is constructed from Settings (ADR 0011, ADR 0043).

Every live role — Quick/Think counselor turns, the goal agent, judge and
criteria writer, auto-titles, document summaries, the eval judge — gets its
model here. DeepSeek on Fireworks reasons by default, so ``reasoning_effort``
is required and becomes the model's own default settings: anything that runs
on the model inherits it, including agents built from it without run-level
settings (the goal-only ``SummarizingCompaction`` tier).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.model_selection import model_name_from_setting
from config.settings import FIREWORKS_MODEL_PREFIX

if TYPE_CHECKING:
    from pydantic_ai.models import Model

    from config.settings import ReasoningEffort

#: Fireworks' OpenAI-compatible endpoint. A module constant because
#: ``FireworksProvider.base_url`` is an instance property.
FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1"


def build_model(settings: Any, model_setting: str, *, reasoning_effort: ReasoningEffort) -> Model:
    """Build the model for *model_setting* (e.g. ``settings.model_cheap``).

    Only ``fireworks:`` is supported; the Settings validator rejects anything
    else at boot, and this raises too so a hand-built Settings cannot slip
    through. Transport retries are the openai SDK's own (408/409/429/5xx and
    connection errors, never 400/401/403); ``agent_model_retry_attempts`` is
    total attempts, so the SDK gets one fewer retries.
    """
    if not model_setting.startswith(FIREWORKS_MODEL_PREFIX):
        raise ValueError(
            f"model setting {model_setting!r} must start with {FIREWORKS_MODEL_PREFIX!r} "
            "— Fireworks is the only supported live provider (ADR 0043)"
        )
    if not settings.fireworks_api_key:
        raise ValueError("COUNSELLE_FIREWORKS_API_KEY is not set")

    from openai import AsyncOpenAI
    from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
    from pydantic_ai.providers.fireworks import FireworksProvider

    client = AsyncOpenAI(
        base_url=FIREWORKS_BASE_URL,
        api_key=settings.fireworks_api_key,
        max_retries=settings.agent_model_retry_attempts - 1,
    )
    return OpenAIChatModel(
        model_name_from_setting(model_setting),
        provider=FireworksProvider(openai_client=client),
        settings=OpenAIChatModelSettings(openai_reasoning_effort=reasoning_effort),
    )
