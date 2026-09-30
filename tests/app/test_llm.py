"""The one live-model construction seam (app/llm.py, ADR 0043). No network.

DeepSeek on Fireworks reasons unless told otherwise, so the request body is
what matters: these tests drive the real ``build_model`` model against an
``httpx.MockTransport`` and read the JSON it would have sent.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import httpx
import openai
import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.usage import RunUsage

from app import goal_judge
from app.llm import FIREWORKS_BASE_URL, build_model
from config.settings import get_settings
from domain.goal import GoalCriterion

_MODEL = "fireworks:accounts/fireworks/models/deepseek-v4p1-flash"


def _settings(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "fireworks_api_key": "fw-test-key",
        "agent_model_retry_attempts": 3,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_builds_a_fireworks_model_at_the_requested_effort_without_network() -> None:
    model = build_model(_settings(), _MODEL, reasoning_effort="high")

    assert isinstance(model, OpenAIChatModel)
    assert model.model_name == "accounts/fireworks/models/deepseek-v4p1-flash"
    assert model.settings == {"openai_reasoning_effort": "high"}
    client = model.client
    assert str(client.base_url).rstrip("/") == FIREWORKS_BASE_URL
    # `agent_model_retry_attempts` counts the first try; the SDK counts retries.
    assert client.max_retries == 2


def test_missing_key_raises_a_clear_error() -> None:
    with pytest.raises(ValueError, match="COUNSELLE_FIREWORKS_API_KEY"):
        build_model(_settings(fireworks_api_key=None), _MODEL, reasoning_effort="low")


def test_non_fireworks_prefix_raises() -> None:
    with pytest.raises(ValueError, match="fireworks:"):
        build_model(_settings(), "google-vertex:gemini-2.5-flash", reasoning_effort="low")


@pytest.fixture
def captured_bodies(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Route every AsyncOpenAI that `build_model` creates through a mock
    transport that records the request body and answers with a 400 (never
    retried), so a caller's own retry/fallback path ends the run quickly."""
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(400, json={"error": {"message": "mock transport"}})

    real_client = openai.AsyncOpenAI

    def mocked_client(**kwargs: Any) -> openai.AsyncOpenAI:
        return real_client(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        )

    monkeypatch.setattr(openai, "AsyncOpenAI", mocked_client)
    return bodies


async def test_request_body_carries_the_models_reasoning_effort(
    captured_bodies: list[dict[str, Any]],
) -> None:
    agent = Agent(build_model(_settings(), _MODEL, reasoning_effort="low"))

    with pytest.raises(ModelHTTPError):
        await agent.run("hi")

    assert len(captured_bodies) == 1  # a 400 is never retried
    assert captured_bodies[0]["reasoning_effort"] == "low"
    assert captured_bodies[0]["model"] == "accounts/fireworks/models/deepseek-v4p1-flash"


async def test_goal_judge_request_pins_temperature_zero_at_cheap_effort(
    captured_bodies: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    # The mock's 400 is logged with a rendered traceback; skip that cost.
    monkeypatch.setattr(goal_judge, "logger", SimpleNamespace(warning=lambda *a, **k: None))
    settings = get_settings().model_copy(
        update={"fireworks_api_key": "fw-test-key", "goal_judge_retries": 0}
    )

    await goal_judge.judge_goal(
        statement="goal",
        criteria=(GoalCriterion(id="c1", text="x"),),
        receipts=[],
        final_text="",
        prior_cited_step_ids=(),
        settings=settings,
        usage=RunUsage(),
    )

    assert captured_bodies, "the judge never reached the model"
    assert captured_bodies[0]["temperature"] == 0.0
    assert captured_bodies[0]["reasoning_effort"] == settings.reasoning_effort_cheap == "none"
