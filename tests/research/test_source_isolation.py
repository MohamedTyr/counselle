"""Tests that source gating is respected in gather_external.

Verifies that disabled sources result in zero calls to the corresponding
Tavily search functions.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from domain.specs import SourceConfig

_SEARCH_WEB_PATH = "app.research.gather_external.search_web"
_SEARCH_REDDIT_PATH = "app.research.gather_external.search_reddit"
_EXTRACT_PATH = "app.research.gather_external.extract_urls"
_GET_SETTINGS_PATH = "app.research.gather_external.get_settings"
_GET_WRITER_PATH = "app.research.gather_external.get_stream_writer"
_MAKE_CLIENT_PATH = "app.research.gather_external.make_tavily_client"


def _make_state(source_config: SourceConfig) -> dict[str, Any]:
    return {
        "messages": [
            {
                "kind": "request",
                "parts": [
                    {"part_kind": "user-prompt", "content": "Compare MIT and Stanford"}
                ],
            }
        ],
        "turn_ids": {"message_id": "m1", "user_message_id": "u1", "messages_offset": 0},
        "turn_records": [],
        "source_registry": [],
        "temporal": {"today": "2026-06-27"},
        "research": {
            "plan": {
                "schools": ["MIT", "Stanford"],
                "user_text": "Compare MIT and Stanford",
                "source_config": source_config.model_dump(mode="json"),
            },
            "emissions": [],
            "caps": {},
        },
    }


def _no_op_writer(chunk: Any) -> None:
    pass


def _mock_settings(tavily_key: str | None = "tvly-test") -> MagicMock:
    settings = MagicMock()
    settings.deep_research_max_tavily_searches = 8
    settings.deep_research_max_tavily_extract_urls = 12
    settings.search_max_results = 5
    settings.tavily_api_key = tavily_key
    settings.vertex_api_key = None
    return settings


@pytest.mark.asyncio
async def test_reddit_disabled_no_reddit_call() -> None:
    """When SourceConfig.reddit=False, search_reddit is never called."""
    source_config = SourceConfig(web=True, reddit=False, edu=True)
    state = _make_state(source_config)

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock) as mock_reddit,
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())
        mock_reddit.assert_not_called()


@pytest.mark.asyncio
async def test_web_disabled_no_extra_web_call() -> None:
    """When SourceConfig.web=False, the general web search phase is skipped."""
    source_config = SourceConfig(web=False, reddit=False, edu=True)
    state = _make_state(source_config)

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(
            _SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}
        ) as mock_web,
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())
        # edu=True → up to 2 edu searches (one per school); web=False → 0 extra
        # Total call count must be at most 2 (edu only, no general web phase)
        assert mock_web.call_count <= 2


@pytest.mark.asyncio
async def test_all_sources_disabled_no_tavily_calls() -> None:
    """When all sources disabled, no Tavily calls are made."""
    source_config = SourceConfig(web=False, reddit=False, edu=False)
    state = _make_state(source_config)

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(
            _SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}
        ) as mock_web,
        patch(
            _SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}
        ) as mock_reddit,
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]) as mock_extract,
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())
        mock_web.assert_not_called()
        mock_reddit.assert_not_called()
        mock_extract.assert_not_called()


@pytest.mark.asyncio
async def test_no_tavily_key_sets_external_unavailable() -> None:
    """When tavily_api_key is missing, external_unavailable is set in caps."""
    source_config = SourceConfig(web=True, reddit=True, edu=True)
    state = _make_state(source_config)

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings(tavily_key=None)),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
    ):
        from app.research.gather_external import research_gather_external_node

        result = await research_gather_external_node(state, MagicMock())
        assert result["research"]["caps"].get("external_unavailable") is True
