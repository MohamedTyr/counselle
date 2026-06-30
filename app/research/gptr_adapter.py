"""Bounded GPT-Researcher adapter for supplemental external gathering.

GPT-Researcher is never the owner of the Counselle research workflow. It may
collect/summarize allowed external sources, but the final source registry,
verification, and synthesis stay in Counselle code.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
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

    timeout = _gptr_timeout(settings, timeout_s)
    return await _run_gptr_subprocess(
        query,
        source_config,
        settings,
        domains=domains,
        today=today,
        timeout=timeout,
    )


async def _gather_via_gptr_direct(
    query: str,
    source_config: SourceConfig,
    settings: Any,
    *,
    domains: list[str] | None,
    today: date,
) -> dict[str, Any]:
    """Run GPT-Researcher in the current process.

    The public adapter runs this in a child process so the caller can enforce a
    hard timeout even when GPT-Researcher or an underlying SDK blocks.
    """
    try:
        from gpt_researcher import GPTResearcher
    except Exception:
        return {"results": [], "cost_usd": None, "unavailable": "package_not_installed"}

    env = _gptr_env(settings)
    query_domains = domains if source_config.edu and not source_config.web else None

    try:
        async with _GPTR_ENV_LOCK:
            with _temporary_env(env):
                with _gptr_vertex_express_patch(settings):
                    researcher = GPTResearcher(
                        query=query,
                        report_type="research_report",
                        report_source="web",
                        query_domains=query_domains,
                        verbose=False,
                        max_subtopics=1,
                    )
                    await researcher.conduct_research()
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


async def _run_gptr_subprocess(
    query: str,
    source_config: SourceConfig,
    settings: Any,
    *,
    domains: list[str] | None,
    today: date,
    timeout: float,
) -> dict[str, Any]:
    """Run GPTR in a killable worker process with secrets passed over stdin."""
    request = {
        "query": query,
        "source_config": source_config.model_dump(mode="json"),
        "settings": _gptr_settings_payload(settings),
        "domains": domains or [],
        "today": today.isoformat(),
    }
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.research.gptr_worker",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _stderr = await asyncio.wait_for(
            proc.communicate(json.dumps(request).encode("utf-8")),
            timeout=timeout,
        )
    except TimeoutError:
        proc.kill()
        await proc.communicate()
        return {"results": [], "cost_usd": None, "unavailable": "TimeoutError"}

    if proc.returncode != 0:
        return {"results": [], "cost_usd": None, "unavailable": "worker_failed"}
    result = _parse_worker_json(stdout)
    if result is None:
        return {"results": [], "cost_usd": None, "unavailable": "worker_bad_output"}
    return result


def _parse_worker_json(stdout: bytes) -> dict[str, Any] | None:
    """Parse the last JSON line so noisy dependencies cannot corrupt output."""
    for line in reversed(stdout.decode("utf-8", errors="replace").splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            return data
    return None


def _gptr_settings_payload(settings: Any) -> dict[str, Any]:
    """Minimal settings snapshot for the worker; never log the returned dict."""
    return {
        "deep_research_use_gptr": bool(getattr(settings, "deep_research_use_gptr", False)),
        "tavily_api_key": getattr(settings, "tavily_api_key", None),
        "gemini_api_key": getattr(settings, "gemini_api_key", None),
        "vertex_api_key": getattr(settings, "vertex_api_key", None),
        "google_cloud_project": getattr(settings, "google_cloud_project", None),
        "google_cloud_location": getattr(settings, "google_cloud_location", None),
        "effective_model_research_fast": str(settings.effective_model_research_fast),
        "effective_model_research_smart": str(settings.effective_model_research_smart),
        "effective_model_research_verifier": str(settings.effective_model_research_verifier),
        "search_max_results": int(getattr(settings, "search_max_results", 5)),
        "deep_research_max_final_sources": int(
            getattr(settings, "deep_research_max_final_sources", 12)
        ),
        "deep_research_gptr_timeout_s": int(
            getattr(settings, "deep_research_gptr_timeout_s", 30)
        ),
    }


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
            env["COUNSELLE_GPTR_VERTEX_API_KEY"] = str(key)
        env["COUNSELLE_GPTR_VERTEX_EXPRESS"] = "true"
        fallback_key = _gptr_gemini_api_key(settings) or (str(key) if key else None)
        if fallback_key:
            env["GOOGLE_API_KEY"] = fallback_key
            env["GEMINI_API_KEY"] = fallback_key
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
    return bool(getattr(settings, "vertex_api_key", None))


def _gptr_gemini_api_key(settings: Any) -> str | None:
    value = (
        getattr(settings, "gemini_api_key", None)
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    )
    return str(value) if value else None


def _gptr_model(model_setting: str) -> str:
    if model_setting.startswith("google-vertex:"):
        return f"google_genai:{model_setting.split(':', 1)[1]}"
    return model_setting


@contextmanager
def _gptr_vertex_express_patch(settings: Any) -> Iterator[None]:
    """Make GPTR's LangChain LLM seam use Google GenAI Vertex express mode.

    GPT-Researcher constructs LLMs through ``GenericLLMProvider.from_provider``.
    The installed LangChain Google provider can use Vertex with API keys, but its
    Vertex backend still requires ``GOOGLE_CLOUD_PROJECT``/ADC. Counselle's
    supported local/prototype auth path is Vertex express mode:
    ``genai.Client(vertexai=True, api_key=...)``. Patch only the child-process
    GPTR provider seam, only for Vertex-configured research models.
    """
    if not _gptr_requires_vertex_backend(settings):
        with nullcontext():
            yield
        return

    try:
        from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
    except Exception:
        yield
        return

    original_descriptor = GenericLLMProvider.__dict__["from_provider"]
    original = GenericLLMProvider.from_provider

    def from_provider(
        cls: type[Any],
        /,
        provider: str,
        chat_log: str | None = None,
        verbose: bool = True,
        **kwargs: Any,
    ) -> Any:
        if provider == "google_genai" and os.environ.get("COUNSELLE_GPTR_VERTEX_EXPRESS"):
            llm = _VertexExpressChat(
                model=str(kwargs.get("model") or "gemini-2.5-flash"),
                api_key=str(
                    os.environ.get("COUNSELLE_GPTR_VERTEX_API_KEY")
                    or getattr(settings, "vertex_api_key", "")
                ),
                temperature=kwargs.get("temperature"),
                max_tokens=kwargs.get("max_tokens"),
            )
            return cls(llm, chat_log=chat_log, verbose=verbose)
        return original(provider, chat_log=chat_log, verbose=verbose, **kwargs)

    GenericLLMProvider.from_provider = classmethod(from_provider)
    try:
        yield
    finally:
        GenericLLMProvider.from_provider = original_descriptor


class _VertexExpressChat:
    """Small LangChain-compatible chat wrapper over google-genai express auth."""

    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        temperature: Any = None,
        max_tokens: Any = None,
    ) -> None:
        from google import genai

        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.client = genai.Client(vertexai=True, api_key=api_key)

    def invoke(self, messages: Any, *_args: Any, **_kwargs: Any) -> Any:
        from google.genai import types
        from langchain_core.messages import AIMessage

        config_kwargs: dict[str, Any] = {}
        if self.temperature is not None:
            config_kwargs["temperature"] = self.temperature
        if self.max_tokens is not None:
            config_kwargs["max_output_tokens"] = self.max_tokens
        response = self.client.models.generate_content(
            model=self.model,
            contents=_gptr_vertex_contents(messages),
            config=types.GenerateContentConfig(**config_kwargs) if config_kwargs else None,
        )
        return AIMessage(content=response.text or "")

    async def ainvoke(self, messages: Any, *_args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(self.invoke, messages, **kwargs)

    async def astream(self, messages: Any, *_args: Any, **kwargs: Any) -> Any:
        yield await self.ainvoke(messages, **kwargs)


def _gptr_vertex_contents(messages: Any) -> str:
    """Flatten GPTR/LangChain messages into text for google-genai."""
    if isinstance(messages, str):
        return messages
    if isinstance(messages, dict):
        return str(messages.get("content") or messages)
    if isinstance(messages, list):
        parts: list[str] = []
        for item in messages:
            if isinstance(item, dict):
                role = item.get("role")
                content = item.get("content")
            else:
                role = getattr(item, "type", None) or getattr(item, "role", None)
                content = getattr(item, "content", item)
            if content:
                parts.append(f"{role or 'message'}: {content}")
        return "\n".join(parts)
    return str(messages)


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
