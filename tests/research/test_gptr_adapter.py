from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.research.gptr_adapter import (
    _gptr_config_unavailable,
    _gptr_env,
    _gptr_model,
    _gptr_timeout,
    _gptr_vertex_express_patch,
    _results_from_researcher,
    gather_via_gptr,
)
from domain.specs import SourceConfig


class FakeResearcher:
    def get_research_sources(self) -> list[dict[str, str]]:
        return [
            {
                "title": "MIT Admissions",
                "url": "https://mit.edu/admissions",
                "content": "MIT admissions content",
            },
            {
                "title": "Blog",
                "url": "https://example.com/mit",
                "content": "Unofficial context",
            },
        ]

    def get_source_urls(self) -> list[str]:
        return ["https://mit.edu/admissions", "https://example.com/mit"]


def test_gptr_model_maps_vertex_settings_to_google_genai() -> None:
    assert (
        _gptr_model("google-vertex:gemini-2.5-flash")
        == "google_genai:gemini-2.5-flash"
    )


def test_gptr_timeout_uses_smaller_runtime_budget() -> None:
    settings = _settings(deep_research_gptr_timeout_s=30)

    assert _gptr_timeout(settings, None) == 30
    assert _gptr_timeout(settings, 12) == 12
    assert _gptr_timeout(settings, 0.1) == 1


def _settings(**overrides: object) -> SimpleNamespace:
    values = {
        "deep_research_use_gptr": True,
        "tavily_api_key": "tvly",
        "gemini_api_key": None,
        "vertex_api_key": "vertex-key",
        "google_cloud_project": "counselle-dev",
        "google_cloud_location": "us-central1",
        "effective_model_research_fast": "google-vertex:gemini-2.5-flash",
        "effective_model_research_smart": "google-vertex:gemini-2.5-pro",
        "effective_model_research_verifier": "google-vertex:gemini-2.5-flash",
        "search_max_results": 5,
        "deep_research_soft_timeout_s": 75,
        "deep_research_max_final_sources": 12,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_gptr_config_allows_vertex_express_without_project(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("GCP_PROJECT", raising=False)

    assert _gptr_config_unavailable(_settings(google_cloud_project=None)) is None


def test_gptr_env_for_vertex_backend_uses_express_patch_not_vertex_env() -> None:
    env = _gptr_env(_settings())

    assert env["FAST_LLM"] == "google_genai:gemini-2.5-flash"
    assert env["SMART_LLM"] == "google_genai:gemini-2.5-pro"
    assert env["COUNSELLE_GPTR_VERTEX_EXPRESS"] == "true"
    assert env["COUNSELLE_GPTR_VERTEX_API_KEY"] == "vertex-key"
    assert "GOOGLE_GENAI_USE_VERTEXAI" not in env
    assert "GOOGLE_CLOUD_PROJECT" not in env
    assert env["GOOGLE_CLOUD_LOCATION"] == "us-central1"


def test_gptr_env_for_plain_google_genai_uses_gemini_key_not_vertex_key() -> None:
    env = _gptr_env(
        _settings(
            gemini_api_key="gemini-key",
            effective_model_research_fast="google_genai:gemini-2.5-flash",
            effective_model_research_smart="google_genai:gemini-2.5-pro",
            effective_model_research_verifier="google_genai:gemini-2.5-flash",
        )
    )

    assert env["FAST_LLM"] == "google_genai:gemini-2.5-flash"
    assert env["GOOGLE_API_KEY"] == "gemini-key"
    assert env["GEMINI_API_KEY"] == "gemini-key"
    assert "GOOGLE_GENAI_USE_VERTEXAI" not in env


def test_gptr_config_requires_gemini_key_for_plain_google_genai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    assert (
        _gptr_config_unavailable(
            _settings(
                gemini_api_key=None,
                effective_model_research_fast="google_genai:gemini-2.5-flash",
                effective_model_research_smart="google_genai:gemini-2.5-pro",
                effective_model_research_verifier="google_genai:gemini-2.5-flash",
            )
        )
        == "missing_model_key"
    )


def test_gptr_config_requires_vertex_key_for_vertex_express() -> None:
    assert (
        _gptr_config_unavailable(_settings(vertex_api_key=None))
        == "missing_model_key"
    )


@pytest.mark.asyncio
async def test_gptr_vertex_without_project_runs_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("GCP_PROJECT", raising=False)

    expected: dict[str, object] = {"results": [], "cost_usd": None, "unavailable": None}
    with patch(
        "app.research.gptr_adapter._run_gptr_subprocess",
        new_callable=AsyncMock,
        return_value=expected,
    ) as worker:
        result = await gather_via_gptr(
            "MIT testing policy",
            SourceConfig(web=False, reddit=False, edu=True),
            _settings(google_cloud_project=None),
            domains=["mitadmissions.org"],
            today=date(2026, 6, 28),
        )

    assert result == expected
    worker.assert_awaited_once()


def test_vertex_express_patch_intercepts_google_genai_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from gpt_researcher.llm_provider.generic.base import GenericLLMProvider

    monkeypatch.setenv("COUNSELLE_GPTR_VERTEX_EXPRESS", "true")
    monkeypatch.setenv("COUNSELLE_GPTR_VERTEX_API_KEY", "vertex-key")
    settings = _settings(google_cloud_project=None)
    original = GenericLLMProvider.__dict__["from_provider"]

    with _gptr_vertex_express_patch(settings):
        provider = GenericLLMProvider.from_provider(
            "google_genai",
            model="gemini-2.5-flash",
            temperature=0,
            max_tokens=20,
        )
        assert provider.llm.__class__.__name__ == "_VertexExpressChat"

    assert GenericLLMProvider.__dict__["from_provider"] is original


def test_results_respect_official_only_domain_filter() -> None:
    results = _results_from_researcher(
        FakeResearcher(),
        report="fallback report text",
        source_config=SourceConfig(web=False, reddit=False, edu=True),
        official_domains=["mit.edu"],
        today=date(2026, 6, 27),
        limit=10,
    )

    assert [item["url"] for item in results] == ["https://mit.edu/admissions"]
    assert results[0]["citation"]["source"] == "edu"
    assert "Supplemental GPT-Researcher" in results[0]["citation"]["caveat"]


def test_results_allow_general_web_when_enabled() -> None:
    results = _results_from_researcher(
        FakeResearcher(),
        report="fallback report text",
        source_config=SourceConfig(web=True, reddit=False, edu=False),
        official_domains=[],
        today=date(2026, 6, 27),
        limit=10,
    )

    assert {item["url"] for item in results} == {
        "https://mit.edu/admissions",
        "https://example.com/mit",
    }
    assert {item["citation"]["source"] for item in results} == {"web"}
