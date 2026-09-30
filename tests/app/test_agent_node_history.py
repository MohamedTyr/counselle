"""The history the agent node hands the model (app/agent_node.py::_split_user_message).

Earlier turns' ``ThinkingPart``s — including another provider's, from chats
started before ADR 0043 — must never reach the model: PydanticAI would inline
them as ``<think>`` text in assistant messages. No DB, no LLM.
"""

from __future__ import annotations

import copy
from types import SimpleNamespace
from typing import cast

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    ThinkingPart,
    UserPromptPart,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.agent_node import _split_user_message
from app.llm import build_model


def _raw(messages: list[ModelMessage]) -> list[dict[str, object]]:
    return cast(
        list[dict[str, object]], ModelMessagesTypeAdapter.dump_python(messages, mode="json")
    )


def _pre_switch_chat() -> list[dict[str, object]]:
    return _raw(
        [
            ModelRequest(parts=[UserPromptPart(content="Is Duke a reach?")]),
            # A thinking-only response: nothing survives the strip.
            ModelResponse(
                parts=[ThinkingPart(content="gemini thought", provider_name="google-vertex")]
            ),
            ModelRequest(parts=[UserPromptPart(content="And Rice?")]),
            ModelResponse(
                parts=[
                    ThinkingPart(content="another thought", provider_name="google-vertex"),
                    TextPart(content="Rice is a reach for most applicants."),
                ]
            ),
            ModelRequest(parts=[UserPromptPart(content="Compare them.")]),
        ]
    )


def test_prior_thinking_is_stripped_and_emptied_responses_dropped() -> None:
    raw = _pre_switch_chat()
    before = copy.deepcopy(raw)

    history, prompt = _split_user_message(raw)

    assert prompt == "Compare them."
    assert [type(message) for message in history] == [ModelRequest, ModelRequest, ModelResponse]
    response = history[-1]
    assert isinstance(response, ModelResponse)
    assert response.parts == [TextPart(content="Rice is a reach for most applicants.")]
    # The checkpointed messages are never rewritten.
    assert raw == before


async def test_stripped_history_is_accepted_and_sends_no_think_text() -> None:
    history, prompt = _split_user_message(_pre_switch_chat())

    seen: list[list[ModelMessage]] = []

    def reply(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.append(messages)
        return ModelResponse(parts=[TextPart(content="Both are reaches.")])

    result = await Agent(FunctionModel(reply)).run(prompt, message_history=history)
    assert result.output == "Both are reaches."

    production_model = build_model(
        SimpleNamespace(
            fireworks_api_key="offline-test-key",
            agent_model_retry_attempts=1,
            model_read_timeout_s=45.0,
        ),
        "fireworks:accounts/fireworks/models/deepseek-v4p1-flash",
        reasoning_effort="low",
    )
    mapped = await production_model._map_messages(  # type: ignore[attr-defined]
        seen[0], ModelRequestParameters()
    )
    assert "<think>" not in repr(mapped)
    assert "gemini thought" not in repr(mapped)
