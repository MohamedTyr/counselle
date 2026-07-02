"""Research-model construction.

Deep Research has two Google auth paths:

- ``google-vertex:*`` / ``google-cloud:*`` -> Vertex / Google Cloud provider
- ``google_genai:*`` / ``google:*`` -> Gemini API / AI Studio provider

Keeping this in one file prevents each research node from silently assuming
Vertex when the configured model tier says otherwise.
"""

from __future__ import annotations

from typing import Any

from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.google_cloud import GoogleCloudProvider

_GEMINI_API_PROVIDERS = {"google", "google_genai", "gemini"}
_VERTEX_PROVIDERS = {"google-cloud", "google-vertex", "vertex"}


def split_model_setting(model_setting: str) -> tuple[str | None, str]:
    """Return ``(provider, bare_model)`` from a provider-qualified setting."""
    if ":" not in model_setting:
        return None, model_setting
    provider, model_name = model_setting.split(":", 1)
    return provider.strip().lower(), model_name.strip()


def build_research_model(model_setting: str, settings: Any) -> GoogleModel:
    """Build the PydanticAI GoogleModel for one research tier."""
    provider, model_name = split_model_setting(model_setting)
    if provider in _GEMINI_API_PROVIDERS:
        api_key = getattr(settings, "gemini_api_key", None)
        if not api_key:
            raise RuntimeError(
                "COUNSELLE_GEMINI_API_KEY or GOOGLE_API_KEY is not set for "
                f"research model {model_setting!r}."
            )
        return GoogleModel(model_name, provider=GoogleProvider(api_key=api_key))

    if provider in _VERTEX_PROVIDERS:
        api_key = getattr(settings, "vertex_api_key", None)
        if not api_key:
            raise RuntimeError(
                "COUNSELLE_VERTEX_API_KEY is not set for "
                f"research model {model_setting!r}."
            )
        return GoogleModel(model_name, provider=GoogleCloudProvider(api_key=api_key))

    if provider is None:
        return _build_unqualified_google_model(model_name, settings)

    raise ValueError(
        f"Unsupported research model provider {provider!r}. Use google_genai:* "
        "for the Gemini API or google-vertex:* / google-cloud:* for Vertex."
    )


def _build_unqualified_google_model(model_name: str, settings: Any) -> GoogleModel:
    """Support bare Gemini model names without guessing wrong when both keys exist."""
    gemini_key = getattr(settings, "gemini_api_key", None)
    vertex_key = getattr(settings, "vertex_api_key", None)
    if gemini_key and not vertex_key:
        return GoogleModel(model_name, provider=GoogleProvider(api_key=gemini_key))
    if vertex_key and not gemini_key:
        return GoogleModel(model_name, provider=GoogleCloudProvider(api_key=vertex_key))
    if gemini_key and vertex_key:
        raise ValueError(
            "Research model setting must include a provider prefix when both "
            "COUNSELLE_GEMINI_API_KEY and COUNSELLE_VERTEX_API_KEY are set."
        )
    raise RuntimeError(
        "No Google model key configured for research. Set "
        "COUNSELLE_GEMINI_API_KEY/GOOGLE_API_KEY or COUNSELLE_VERTEX_API_KEY."
    )
