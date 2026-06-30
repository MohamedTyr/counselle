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
_SEARCH_SCHOOL_SITE_PATH = "app.research.gather_external.search_school_site"
_SEARCH_REDDIT_PATH = "app.research.gather_external.search_reddit"
_EXTRACT_PATH = "app.research.gather_external.extract_urls"
_RESOLVE_UNITID_PATH = "app.research.gather_external._resolve_unitid"
_GATHER_GPTR_PATH = "app.research.gather_external.gather_via_gptr"
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


def _mock_settings(tavily_key: str | None = "tvly-test", *, gptr: bool = False) -> MagicMock:
    settings = MagicMock()
    settings.deep_research_max_tavily_searches = 8
    settings.deep_research_max_tavily_extract_urls = 12
    settings.deep_research_max_final_sources = 12
    settings.deep_research_soft_timeout_s = 75
    settings.deep_research_gptr_timeout_s = 30
    settings.search_max_results = 5
    settings.tavily_api_key = tavily_key
    settings.vertex_api_key = None
    settings.deep_research_use_gptr = gptr
    return settings


def test_official_queries_are_scoped_to_the_resolved_school() -> None:
    from app.research.gather_external import _official_queries_for_school

    plan = {
        "user_text": "Compare MIT and Stanford for CS admissions, aid, and testing.",
        "research_plan": {
            "topics": ["Computer Science admissions", "financial aid", "test policy"]
        },
    }
    grouped = {
        "official": [
            "MIT computer science admissions requirements",
            "Stanford computer science admissions requirements",
        ]
    }

    queries = _official_queries_for_school(
        plan, grouped, "Massachusetts Institute of Technology"
    )

    assert queries[0] == (
        "Massachusetts Institute of Technology computer science undergraduate "
        "admissions requirements"
    )
    assert (
        "Massachusetts Institute of Technology undergraduate financial aid grants cost "
        "of attendance"
    ) in queries
    assert "Massachusetts Institute of Technology undergraduate SAT ACT test policy" in queries
    assert (
        "Massachusetts Institute of Technology undergraduate admissions requirements"
        in queries
    )
    assert "MIT computer science admissions requirements" in queries
    assert "Stanford computer science admissions requirements" not in queries


def test_per_school_query_limit_spreads_official_budget() -> None:
    from app.research.gather_external import _per_school_query_limit

    assert _per_school_query_limit(8, 0, ["MIT", "Stanford"]) == 4
    assert _per_school_query_limit(4, 0, ["MIT", "Stanford"]) == 2
    assert _per_school_query_limit(2, 1, ["MIT", "Stanford", "CMU"]) == 1


def test_official_search_budget_reserves_enabled_supplemental_sources() -> None:
    from app.research.gather_external import _official_search_budget

    assert _official_search_budget(8, 0, SourceConfig(web=True, reddit=True, edu=True)) == 6
    assert _official_search_budget(8, 0, SourceConfig(web=True, reddit=False, edu=True)) == 7
    assert _official_search_budget(8, 0, SourceConfig(web=False, reddit=False, edu=True)) == 8
    assert _official_search_budget(2, 1, SourceConfig(web=True, reddit=True, edu=True)) == 0


@pytest.mark.asyncio
async def test_official_searches_interleave_schools_before_later_queries() -> None:
    source_config = SourceConfig(web=False, reddit=False, edu=True)
    state = _make_state(source_config)
    state["research"]["plan"]["research_plan"] = {
        "topics": ["computer science admissions", "financial aid", "test policy"]
    }

    async def resolve_by_school(deps: Any, school_name: str) -> int:
        return {"MIT": 101, "Stanford": 202}[school_name]

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_RESOLVE_UNITID_PATH, side_effect=resolve_by_school),
        patch(
            _SEARCH_SCHOOL_SITE_PATH,
            new_callable=AsyncMock,
            return_value={"results": []},
        ) as mock_school_site,
        patch(_SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())

    called_unitids = [call.args[2] for call in mock_school_site.await_args_list[:4]]
    assert called_unitids == [101, 202, 101, 202]


@pytest.mark.asyncio
async def test_default_official_budget_keeps_aid_and_testing_for_each_school() -> None:
    source_config = SourceConfig(web=True, reddit=True, edu=True)
    state = _make_state(source_config)
    state["research"]["plan"]["research_plan"] = {
        "topics": ["computer science admissions", "financial aid", "test policy"]
    }

    async def resolve_by_school(deps: Any, school_name: str) -> int:
        return {"MIT": 101, "Stanford": 202}[school_name]

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_RESOLVE_UNITID_PATH, side_effect=resolve_by_school),
        patch(
            _SEARCH_SCHOOL_SITE_PATH,
            new_callable=AsyncMock,
            return_value={"results": []},
        ) as mock_school_site,
        patch(_SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())

    called_queries = [call.args[3] for call in mock_school_site.await_args_list[:6]]
    assert called_queries == [
        "MIT computer science undergraduate admissions requirements",
        "Stanford computer science undergraduate admissions requirements",
        "MIT undergraduate financial aid grants cost of attendance",
        "Stanford undergraduate financial aid grants cost of attendance",
        "MIT undergraduate SAT ACT test policy",
        "Stanford undergraduate SAT ACT test policy",
    ]


def test_filter_school_related_results_removes_unrelated_school_pages() -> None:
    from app.research.gather_external import _filter_school_related_results

    results = [
        {
            "title": "MIT admissions",
            "url": "https://mitadmissions.org/apply",
            "snippet": "MIT first-year application requirements.",
        },
        {
            "title": "Sattler admission requirements",
            "url": "https://sattler.edu/admissions",
            "snippet": "Sattler College admissions, SAT details, and technology policies.",
        },
        {
            "title": "Stanford testing",
            "url": "https://admission.stanford.edu/apply/testing.html",
            "snippet": "Stanford ACT or SAT requirements.",
        },
    ]

    filtered = _filter_school_related_results(
        results,
        ["Massachusetts Institute of Technology", "Stanford University"],
    )

    assert [item["title"] for item in filtered] == ["MIT admissions", "Stanford testing"]


def test_preserve_extracted_citations_keeps_school_site_official_tiering() -> None:
    from app.research.gather_external import _preserve_extracted_citations

    citation = {
        "source": "edu",
        "tier": "official",
        "vintage": "Retrieved Jun 28, 2026 (school's official site)",
        "url": "https://mitadmissions.org/apply/firstyear/tests-scores",
    }
    extracted = [
        {
            "title": "https://mitadmissions.org/apply/firstyear/tests-scores",
            "url": "https://mitadmissions.org/apply/firstyear/tests-scores",
            "snippet": "MIT requires the SAT or ACT.",
            "citation": {
                "source": "web",
                "tier": "community",
                "vintage": "Retrieved Jun 28, 2026 (live web)",
                "url": "https://mitadmissions.org/apply/firstyear/tests-scores",
            },
        }
    ]

    preserved = _preserve_extracted_citations(
        extracted,
        {"https://mitadmissions.org/apply/firstyear/tests-scores": citation},
    )

    assert preserved[0]["citation"] == citation


def test_preserve_extracted_citations_keeps_research_context_tags() -> None:
    from app.research.gather_external import _preserve_extracted_citations

    url = "https://financialaid.stanford.edu/undergrad"
    citation = {
        "source": "edu",
        "tier": "official",
        "vintage": "Retrieved Jun 28, 2026 (school's official site)",
        "url": url,
    }
    extracted = [
        {
            "title": url,
            "url": url,
            "snippet": "Stanford undergraduate financial aid details.",
            "citation": {
                "source": "web",
                "tier": "community",
                "vintage": "Retrieved Jun 28, 2026 (live web)",
                "url": url,
            },
        }
    ]

    preserved = _preserve_extracted_citations(
        extracted,
        {
            url: {
                "citation": citation,
                "_research_school": "Stanford University",
                "_research_topic": "aid",
            }
        },
    )

    assert preserved[0]["citation"] == citation
    assert preserved[0]["_research_school"] == "Stanford University"
    assert preserved[0]["_research_topic"] == "aid"


def test_top_urls_balances_extraction_across_school_topic_groups() -> None:
    from app.research.gather_external import _top_urls

    def item(school: str, topic: str, suffix: str) -> dict[str, str]:
        return {
            "title": suffix,
            "url": f"https://example.edu/{suffix}",
            "_research_school": school,
            "_research_topic": topic,
        }

    evidence = [
        item("MIT", "admissions", "mit-admissions-1"),
        item("MIT", "admissions", "mit-admissions-2"),
        item("MIT", "admissions", "mit-admissions-3"),
        item("Stanford", "admissions", "stanford-admissions-1"),
        item("Stanford", "admissions", "stanford-admissions-2"),
        item("MIT", "aid", "mit-aid-1"),
        item("Stanford", "aid", "stanford-aid-1"),
        item("MIT", "testing", "mit-testing-1"),
        item("Stanford", "testing", "stanford-testing-1"),
    ]

    assert _top_urls(evidence, 6) == [
        "https://example.edu/mit-admissions-1",
        "https://example.edu/stanford-admissions-1",
        "https://example.edu/mit-aid-1",
        "https://example.edu/stanford-aid-1",
        "https://example.edu/mit-testing-1",
        "https://example.edu/stanford-testing-1",
    ]


def test_tag_research_context_adds_school_and_topic_hints() -> None:
    from app.research.gather_external import _tag_research_context

    tagged = _tag_research_context(
        {
            "results": [
                {
                    "title": "Testing policy",
                    "url": "https://admission.stanford.edu/testing",
                    "snippet": "SAT or ACT policy",
                }
            ]
        },
        school="Stanford University",
        query="Stanford undergraduate SAT ACT test policy",
    )

    assert tagged["results"][0]["_research_school"] == "Stanford University"
    assert tagged["results"][0]["_research_topic"] == "testing"


@pytest.mark.asyncio
async def test_web_duplicate_keeps_existing_official_marker() -> None:
    source_config = SourceConfig(web=True, reddit=False, edu=True)
    state = _make_state(source_config)
    state["research"]["plan"]["schools"] = ["MIT"]
    official_url = "https://mitadmissions.org/apply/firstyear/deadlines-requirements"
    official_item = {
        "title": "MIT deadlines",
        "url": official_url,
        "snippet": "Official MIT admissions page.",
        "citation": {
            "source": "edu",
            "tier": "official",
            "vintage": "Retrieved Jun 28, 2026 (school's official site)",
            "url": official_url,
        },
    }
    web_duplicate = {
        "title": "MIT deadlines",
        "url": official_url,
        "snippet": "Same URL from broad web search.",
        "citation": {
            "source": "web",
            "tier": "community",
            "vintage": "Retrieved Jun 28, 2026 (live web)",
            "url": official_url,
            "caveat": "General web source.",
        },
    }

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_RESOLVE_UNITID_PATH, new_callable=AsyncMock, return_value=101),
        patch(
            _SEARCH_SCHOOL_SITE_PATH,
            new_callable=AsyncMock,
            return_value={"results": [official_item]},
        ),
        patch(
            _SEARCH_WEB_PATH,
            new_callable=AsyncMock,
            return_value={"results": [web_duplicate]},
        ),
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        result = await research_gather_external_node(state, MagicMock())

    matching_sources = [
        item
        for item in result["source_registry"]
        if (item.get("citation") or {}).get("url") == official_url
    ]
    assert len(matching_sources) == 1
    assert matching_sources[0]["citation"]["source"] == "edu"
    assert matching_sources[0]["citation"]["tier"] == "official"


@pytest.mark.asyncio
async def test_reddit_disabled_no_reddit_call() -> None:
    """When SourceConfig.reddit=False, search_reddit is never called."""
    source_config = SourceConfig(web=True, reddit=False, edu=True)
    state = _make_state(source_config)

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_RESOLVE_UNITID_PATH, new_callable=AsyncMock, return_value=123),
        patch(_SEARCH_SCHOOL_SITE_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock) as mock_reddit,
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
        patch(_GATHER_GPTR_PATH, new_callable=AsyncMock) as mock_gptr,
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())
        mock_reddit.assert_not_called()
        mock_gptr.assert_not_called()


@pytest.mark.asyncio
async def test_web_disabled_no_extra_web_call() -> None:
    """When SourceConfig.web=False, the general web search phase is skipped."""
    source_config = SourceConfig(web=False, reddit=False, edu=True)
    state = _make_state(source_config)

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_RESOLVE_UNITID_PATH, new_callable=AsyncMock, return_value=123),
        patch(_SEARCH_SCHOOL_SITE_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(
            _SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}
        ) as mock_web,
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())
        mock_web.assert_not_called()


@pytest.mark.asyncio
async def test_all_sources_disabled_no_tavily_calls() -> None:
    """When all sources disabled, no Tavily calls are made."""
    source_config = SourceConfig(web=False, reddit=False, edu=False)
    state = _make_state(source_config)

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings()),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_RESOLVE_UNITID_PATH, new_callable=AsyncMock) as mock_resolve_unitid,
        patch(
            _SEARCH_SCHOOL_SITE_PATH, new_callable=AsyncMock, return_value={"results": []}
        ) as mock_school_site,
        patch(
            _SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}
        ) as mock_web,
        patch(
            _SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}
        ) as mock_reddit,
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]) as mock_extract,
        patch(_GATHER_GPTR_PATH, new_callable=AsyncMock) as mock_gptr,
    ):
        from app.research.gather_external import research_gather_external_node

        await research_gather_external_node(state, MagicMock())
        mock_resolve_unitid.assert_not_called()
        mock_school_site.assert_not_called()
        mock_web.assert_not_called()
        mock_reddit.assert_not_called()
        mock_extract.assert_not_called()
        mock_gptr.assert_not_called()


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


@pytest.mark.asyncio
async def test_gptr_flag_runs_bounded_helper_and_records_cost() -> None:
    """When GPTR is enabled, its results enter the normal source registry."""
    source_config = SourceConfig(web=True, reddit=False, edu=False)
    state = _make_state(source_config)
    gptr_result = {
        "results": [
            {
                "title": "MIT admissions",
                "url": "https://mit.edu/admissions",
                "snippet": "Admissions context",
                "citation": {
                    "source": "web",
                    "tier": "official",
                    "vintage": "GPT-Researcher/Tavily 2026-06-27",
                    "url": "https://mit.edu/admissions",
                },
            }
        ],
        "cost_usd": 0.01,
        "unavailable": None,
    }

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings(gptr=True)),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(_GATHER_GPTR_PATH, new_callable=AsyncMock, return_value=gptr_result) as mock_gptr,
        patch(_SEARCH_SCHOOL_SITE_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        result = await research_gather_external_node(state, MagicMock())

    mock_gptr.assert_awaited_once()
    evidence = result["research"]["web_evidence"]
    assert evidence[0]["marker"] == "[1]"
    assert result["research"]["usage"]["est_cost_usd"] == 0.01


@pytest.mark.asyncio
async def test_gptr_unavailable_is_recorded_and_direct_search_continues() -> None:
    source_config = SourceConfig(web=True, reddit=False, edu=False)
    state = _make_state(source_config)
    state["research"]["caps"] = {"db_unavailable": False}

    with (
        patch(_GET_SETTINGS_PATH, return_value=_mock_settings(gptr=True)),
        patch(_GET_WRITER_PATH, return_value=_no_op_writer),
        patch(_MAKE_CLIENT_PATH, return_value=MagicMock()),
        patch(
            _GATHER_GPTR_PATH,
            new_callable=AsyncMock,
            return_value={"results": [], "cost_usd": None, "unavailable": "missing_model_key"},
        ),
        patch(_SEARCH_SCHOOL_SITE_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_SEARCH_WEB_PATH, new_callable=AsyncMock, return_value={"results": []}) as mock_web,
        patch(_SEARCH_REDDIT_PATH, new_callable=AsyncMock, return_value={"results": []}),
        patch(_EXTRACT_PATH, new_callable=AsyncMock, return_value=[]),
    ):
        from app.research.gather_external import research_gather_external_node

        result = await research_gather_external_node(state, MagicMock())

    assert result["research"]["caps"]["gptr_unavailable"] == "missing_model_key"
    assert result["research"]["caps"]["db_unavailable"] is False
    mock_web.assert_awaited_once()
