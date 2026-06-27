"""The research_gather_external node — source-gated, capped external search.

Calls Tavily adapters in sequence, gated on SourceConfig and capped by
the deep_research_max_tavily_* settings. On any Tavily failure, marks
caps.external_unavailable and continues — partial is honest.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from langgraph.config import get_stream_writer

from adapters.tavily_tools import extract_urls, make_tavily_client, search_reddit, search_web
from app.research.steps import research_step
from app.sources import SourceRegistry
from config.settings import get_settings
from domain.specs import SourceConfig

logger = logging.getLogger(__name__)


async def research_gather_external_node(state: Any, deps: Any) -> dict[str, Any]:
    """Run source-gated, cap-bounded Tavily searches and extractions."""
    settings = get_settings()
    writer = get_stream_writer()
    research = dict(state.get("research") or {})
    emissions = list(research.get("emissions") or [])
    caps = dict(research.get("caps") or {})

    registry = SourceRegistry(state.get("source_registry") or [])

    plan = research.get("plan") or {}
    user_text = plan.get("user_text") or ""
    schools = plan.get("schools") or []
    source_config = SourceConfig.model_validate(
        plan.get("source_config") or state.get("source_config") or {}
    )

    today_str = (state.get("temporal") or {}).get("today") or date.today().isoformat()
    today = date.fromisoformat(today_str)

    searches_used: int = int(caps.get("tavily_searches_used") or 0)
    extracts_used: int = int(caps.get("tavily_extracts_used") or 0)
    max_searches = settings.deep_research_max_tavily_searches
    max_extracts = settings.deep_research_max_tavily_extract_urls
    max_results = settings.search_max_results

    web_evidence: list[Any] = []

    if not settings.tavily_api_key:
        caps["external_unavailable"] = True
        research["caps"] = caps
        research["web_evidence"] = web_evidence
        research["emissions"] = emissions
        return {"source_registry": registry.dump(), "research": research}

    try:
        client = make_tavily_client(settings)

        # Official .edu search — one query per school, source-gated.
        if source_config.edu and searches_used < max_searches:
            research_step(
                writer, emissions, "official_search", "running", "Searching official sources"
            )
            for school_name in schools:
                if searches_used >= max_searches:
                    break
                query = f"{school_name} admissions requirements financial aid"
                try:
                    result = await search_web(
                        client,
                        query,
                        today=today,
                        max_results=max_results,
                        exclude_domains=None,
                    )
                    searches_used += 1
                    annotated = registry.annotate_search_results(result)
                    results_list = annotated.get("results") or []
                    web_evidence.extend(results_list)
                except Exception:
                    logger.debug("official search failed for %r", school_name, exc_info=True)
            research_step(
                writer, emissions, "official_search", "complete", "Searching official sources"
            )

        # General web search — one broad query, source-gated.
        if source_config.web and searches_used < max_searches:
            research_step(writer, emissions, "web_search", "running", "Searching the web")
            try:
                result = await search_web(
                    client,
                    user_text,
                    today=today,
                    max_results=max_results,
                )
                searches_used += 1
                annotated = registry.annotate_search_results(result)
                web_evidence.extend(annotated.get("results") or [])
            except Exception:
                logger.debug("web search failed", exc_info=True)
            research_step(writer, emissions, "web_search", "complete", "Searching the web")

        # Reddit community search — source-gated.
        if source_config.reddit and searches_used < max_searches:
            research_step(
                writer, emissions, "community_search", "running", "Checking student sentiment"
            )
            try:
                from config.settings import load_yaml_asset

                subreddit_menu: list[str] = load_yaml_asset("subreddit_menu") or []
                default_subs = [s for s in subreddit_menu if "{school}" not in str(s)][:3]
                if not default_subs:
                    default_subs = ["ApplyingToCollege"]
                result = await search_reddit(
                    client,
                    user_text,
                    default_subs,
                    allowed=subreddit_menu,
                    today=today,
                    max_results=max_results,
                )
                searches_used += 1
                annotated = registry.annotate_search_results(result)
                web_evidence.extend(annotated.get("results") or [])
            except Exception:
                logger.debug("reddit search failed", exc_info=True)
            research_step(
                writer, emissions, "community_search", "complete", "Checking student sentiment"
            )

        # URL extraction — collect top URLs, then extract.
        if extracts_used < max_extracts:
            top_urls = _top_urls(web_evidence, max_extracts - extracts_used)
            if top_urls:
                research_step(
                    writer, emissions, "extract", "running", "Extracting relevant pages"
                )
                extracted = await extract_urls(client, top_urls, today)
                extracts_used += len(top_urls)
                annotated_extracted = registry.annotate_search_results(
                    {"results": extracted}
                ).get("results") or []
                web_evidence.extend(annotated_extracted)
                research_step(
                    writer, emissions, "extract", "complete", "Extracting relevant pages"
                )

    except Exception:
        logger.warning("external gather failed — continuing with partial data", exc_info=True)
        caps["external_unavailable"] = True

    caps["tavily_searches_used"] = searches_used
    caps["tavily_extracts_used"] = extracts_used
    research["caps"] = caps
    research["web_evidence"] = web_evidence
    research["emissions"] = emissions
    return {"source_registry": registry.dump(), "research": research}


def _top_urls(evidence: list[Any], limit: int) -> list[str]:
    """Extract up to limit unique URLs from evidence items."""
    seen: set[str] = set()
    urls: list[str] = []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if url and isinstance(url, str) and url not in seen:
            seen.add(url)
            urls.append(url)
        if len(urls) >= limit:
            break
    return urls
