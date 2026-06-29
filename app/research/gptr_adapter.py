"""Bounded GPT-Researcher adapter for supplemental external gathering.

GPT-Researcher is never the owner of the Counselle research workflow. It may
collect/summarize allowed external sources, but the final source registry,
verification, and synthesis stay in Counselle code.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from typing import Any, Literal
from urllib.parse import urlparse

from domain.envelope import Citation
from domain.specs import SourceConfig

_GPTR_ENV_LOCK = asyncio.Lock()


async def gather_via_gptr(
    query: str,
    source_config: SourceConfig,
    settings: Any,
    *,
    domains: list[str] | None,
    today: date,
    timeout_s: float | None = None,
) -> dict[str, Any]:
    """Run GPT-Researcher as a bounded helper and return search-result evidence.

    Returns ``{"results": [...], "cost_usd": float|None, "unavailable": str|None}``.
    The function never raises for normal configuration/runtime failures; callers
    continue through the direct Tavily path.
    """
    if not getattr(settings, "deep_research_use_gptr", False):
        return {"results": [], "cost_usd": None, "unavailable": None}
    if not (source_config.web or source_config.edu):
        return {"results": [], "cost_usd": None, "unavailable": "all_external_sources_disabled"}
    if source_config.edu and not source_config.web and not domains:
        return {"results": [], "cost_usd": None, "unavailable": "no_official_domains"}
    if not getattr(settings, "tavily_api_key", None):
        return {"results": [], "cost_usd": None, "unavailable": "missing_tavily_key"}
    unavailable = _gptr_config_unavailable(settings)
    if unavailable:
        return {"results": [], "cost_usd": None, "unavailable": unavailable}

    try:
        from gpt_researcher import GPTResearcher
    except Exception:
        return {"results": [], "cost_usd": None, "unavailable": "package_not_installed"}

    env = _gptr_env(settings)
    query_domains = domains if source_config.edu and not source_config.web else None

    try:
        async with _GPTR_ENV_LOCK:
            with _temporary_env(env):
                researcher = GPTResearcher(
                    query=query,
                    report_type="research_report",
                    report_source="web",
                    query_domains=query_domains,
                    verbose=False,
                    max_subtopics=1,
                )
                timeout = _gptr_timeout(settings, timeout_s)
                await asyncio.wait_for(researcher.conduct_research(), timeout=timeout)
                results = _results_from_researcher(
                    researcher,
                    report="",
                    source_config=source_config,
                    official_domains=domains or [],
                    today=today,
                    limit=int(getattr(settings, "deep_research_max_final_sources", 12)),
                )
                cost = researcher.get_costs()
    except Exception as exc:
        return {"results": [], "cost_usd": None, "unavailable": type(exc).__name__}

    return {"results": results, "cost_usd": float(cost) if cost else None, "unavailable": None}


def _gptr_timeout(settings: Any, timeout_s: float | None = None) -> float:
    """Single hard cap for the supplemental GPTR helper."""
    configured = float(getattr(settings, "deep_research_gptr_timeout_s", 30))
    if timeout_s is None:
        return max(1.0, configured)
    return max(1.0, min(configured, float(timeout_s)))


def _gptr_env(settings: Any) -> dict[str, str]:
    fast = _gptr_model(settings.effective_model_research_fast)
    smart = _gptr_model(settings.effective_model_research_smart)
    verifier = _gptr_model(settings.effective_model_research_verifier)
    env = {
        "RETRIEVER": "tavily",
        "TAVILY_API_KEY": str(settings.tavily_api_key),
        "FAST_LLM": fast,
        "SMART_LLM": smart,
        "STRATEGIC_LLM": verifier,
        "EMBEDDING": "google_genai:models/gemini-embedding-001",
        "MAX_SEARCH_RESULTS_PER_QUERY": str(getattr(settings, "search_max_results", 5)),
        "MAX_ITERATIONS": "1",
        "MAX_SUBTOPICS": "1",
        "TOTAL_WORDS": "700",
        "CURATE_SOURCES": "False",
        "IMAGE_GENERATION_ENABLED": "False",
        "SCRAPER": "tavily_extract",
        "VERBOSE": "False",
    }
    if _gptr_requires_vertex_backend(settings):
        key = getattr(settings, "vertex_api_key", None)
        if key:
            env["GOOGLE_API_KEY"] = str(key)
            env["GEMINI_API_KEY"] = str(key)
        env["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
        project = _gptr_google_cloud_project(settings)
        if project:
            env["GOOGLE_CLOUD_PROJECT"] = project
        location = getattr(settings, "google_cloud_location", None)
        if location:
            env["GOOGLE_CLOUD_LOCATION"] = str(location)
    elif _gptr_uses_google_genai(settings):
        key = _gptr_gemini_api_key(settings)
        if key:
            env["GOOGLE_API_KEY"] = key
            env["GEMINI_API_KEY"] = key
    return env


def _gptr_config_unavailable(settings: Any) -> str | None:
    if _gptr_requires_vertex_backend(settings):
        if not _gptr_vertex_credentials_available(settings):
            return "missing_model_key"
        if not _gptr_google_cloud_project(settings):
            return "missing_google_cloud_project"
        return None

    if _gptr_uses_google_genai(settings) and not _gptr_gemini_api_key(settings):
        return "missing_model_key"
    return None


def _gptr_requires_vertex_backend(settings: Any) -> bool:
    return any(
        _raw_gptr_model(settings, name).startswith("google-vertex:")
        for name in (
            "effective_model_research_fast",
            "effective_model_research_smart",
            "effective_model_research_verifier",
        )
    )


def _gptr_uses_google_genai(settings: Any) -> bool:
    return any(
        _gptr_model(_raw_gptr_model(settings, name)).startswith("google_genai:")
        for name in (
            "effective_model_research_fast",
            "effective_model_research_smart",
            "effective_model_research_verifier",
        )
    )


def _raw_gptr_model(settings: Any, name: str) -> str:
    return str(getattr(settings, name))


def _gptr_vertex_credentials_available(settings: Any) -> bool:
    return bool(
        getattr(settings, "vertex_api_key", None)
        or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    )


def _gptr_gemini_api_key(settings: Any) -> str | None:
    value = (
        getattr(settings, "gemini_api_key", None)
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    )
    return str(value) if value else None


def _gptr_google_cloud_project(settings: Any) -> str | None:
    value = (
        getattr(settings, "google_cloud_project", None)
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or os.environ.get("GCP_PROJECT")
    )
    return str(value) if value else None


def _gptr_model(model_setting: str) -> str:
    if model_setting.startswith("google-vertex:"):
        return f"google_genai:{model_setting.split(':', 1)[1]}"
    return model_setting


def _results_from_researcher(
    researcher: Any,
    *,
    report: str,
    source_config: SourceConfig,
    official_domains: list[str],
    today: date,
    limit: int,
) -> list[dict[str, Any]]:
    source_by_url: dict[str, dict[str, Any]] = {}
    for source in researcher.get_research_sources() or []:
        if not isinstance(source, dict):
            continue
        url = _source_url(source)
        if url:
            source_by_url[url] = source

    urls = []
    for url in list(source_by_url) + list(researcher.get_source_urls() or []):
        if isinstance(url, str) and url not in urls:
            urls.append(url)

    results: list[dict[str, Any]] = []
    for url in urls[:limit]:
        if not _url_allowed(url, source_config, official_domains):
            continue
        source = source_by_url.get(url) or {}
        source_name: Literal["edu", "web"] = (
            "edu" if _domain_allowed(url, official_domains) else "web"
        )
        title = str(source.get("title") or url)
        snippet = _snippet(source, report)
        citation = Citation(
            source=source_name,
            tier="official",
            vintage=f"GPT-Researcher/Tavily {today.isoformat()}",
            url=url,
            caveat="Supplemental GPT-Researcher context; verified before use.",
        )
        results.append(
            {
                "title": title,
                "url": url,
                "snippet": snippet,
                "citation": citation.model_dump(mode="json"),
            }
        )
    return results


def _source_url(source: dict[str, Any]) -> str | None:
    for key in ("url", "source", "link"):
        value = source.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    return None


def _snippet(source: dict[str, Any], report: str) -> str:
    for key in ("content", "raw_content", "summary", "snippet"):
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:300]
    return report.strip()[:300]


def _url_allowed(url: str, source_config: SourceConfig, official_domains: list[str]) -> bool:
    if source_config.web:
        return True
    return bool(source_config.edu and _domain_allowed(url, official_domains))


def _domain_allowed(url: str, domains: list[str]) -> bool:
    if not domains:
        return False
    host = (urlparse(url).hostname or "").lower()
    return any(host == domain or host.endswith(f".{domain}") for domain in domains)


@contextmanager
def _temporary_env(values: dict[str, str]) -> Iterator[None]:
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
