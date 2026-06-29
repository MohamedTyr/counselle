from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.google_cloud import GoogleCloudProvider

from app.research.llm import build_research_model, split_model_setting


def test_split_model_setting_returns_provider_and_model() -> None:
    assert split_model_setting("google_genai:gemini-2.5-flash") == (
        "google_genai",
        "gemini-2.5-flash",
    )
    assert split_model_setting("gemini-2.5-flash") == (None, "gemini-2.5-flash")


def test_google_genai_research_model_uses_gemini_api_key() -> None:
    settings = SimpleNamespace(gemini_api_key="gemini-key", vertex_api_key=None)

    model = build_research_model("google_genai:gemini-2.5-flash", settings)

    assert isinstance(model.provider, GoogleProvider)


def test_google_vertex_research_model_uses_cloud_provider() -> None:
    settings = SimpleNamespace(gemini_api_key=None, vertex_api_key="vertex-key")

    model = build_research_model("google-vertex:gemini-2.5-flash", settings)

    assert isinstance(model.provider, GoogleCloudProvider)


def test_google_genai_research_model_requires_gemini_key() -> None:
    settings = SimpleNamespace(gemini_api_key=None, vertex_api_key="vertex-key")

    with pytest.raises(RuntimeError, match="COUNSELLE_GEMINI_API_KEY"):
        build_research_model("google_genai:gemini-2.5-flash", settings)


def test_unqualified_model_requires_prefix_when_both_google_keys_exist() -> None:
    settings = SimpleNamespace(gemini_api_key="gemini-key", vertex_api_key="vertex-key")

    with pytest.raises(ValueError, match="provider prefix"):
        build_research_model("gemini-2.5-flash", settings)
