"""The research_gather_external node — source-gated, capped external search.

Calls Tavily adapters in sequence, gated on SourceConfig and capped by
the deep_research_max_tavily_* settings. On any Tavily failure, marks
caps.external_unavailable and continues — partial is honest.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date
from typing import Any

from langgraph.config import get_stream_writer

from adapters.tavily_tools import (
    extract_urls,
    make_tavily_client,
    search_reddit,
    search_school_site,
    search_web,
)
from app.research.caps import remaining_time_seconds, soft_timeout_hit
from app.research.gptr_adapter import gather_via_gptr
from app.research.steps import research_step
from app.sources import SourceRegistry
from config.settings import get_settings
from counselle_db.models import ResolveMatch
from counselle_db.service import resolve_school
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

    if soft_timeout_hit(research, settings):
        research["web_evidence"] = web_evidence
        research["emissions"] = emissions
        return {"source_registry": registry.dump(), "research": research}

    if not settings.tavily_api_key:
        caps["external_unavailable"] = True
        research["caps"] = caps
        research["web_evidence"] = web_evidence
        research["emissions"] = emissions
        return {"source_registry": registry.dump(), "research": research}

    try:
        client = make_tavily_client(settings)

        plan_queries = _queries_by_source(plan)

        # Official school-site search — scoped through the school's DB website.
        if (
            source_config.edu
            and searches_used < max_searches
            and not soft_timeout_hit(research, settings)
        ):
            official_budget = _official_search_budget(max_searches, searches_used, source_config)
            official_search_limit = searches_used + official_budget
            if official_budget > 0:
                research_step(
                    writer, emissions, "official_search", "running", "Checking official pages"
                )
            per_school_query_limit = _per_school_query_limit(official_budget, 0, schools)
            planned_searches: list[tuple[str, int, list[str]]] = []
            for school_name in schools:
                unitid = await _resolve_unitid(deps, school_name)
                if unitid is None:
                    continue
                queries = _official_queries_for_school(plan, plan_queries, school_name)
                planned_searches.append((school_name, unitid, queries[:per_school_query_limit]))
            for query_index in range(per_school_query_limit):
                for school_name, unitid, queries in planned_searches:
                    if query_index >= len(queries):
                        continue
                    if (
                        searches_used >= official_search_limit
                        or soft_timeout_hit(research, settings)
                    ):
                        break
                    query = queries[query_index]
                    try:
                        result = await _bounded_external_call(
                            search_school_site,
                            client,
                            deps.catalog,
                            unitid,
                            query,
                            today=today,
                            max_results=max_results,
                            research=research,
                            settings=settings,
                            caps=caps,
                        )
                        searches_used += 1
                        result = _tag_research_context(
                            result,
                            school=school_name,
                            query=query,
                        )
                        annotated = registry.annotate_search_results(result)
                        results_list = annotated.get("results") or []
                        web_evidence.extend(results_list)
                    except Exception:
                        logger.debug("official search failed for %r", school_name, exc_info=True)
            if official_budget > 0:
                research_step(
                    writer, emissions, "official_search", "complete", "Checking official pages"
                )

        # General web search — one broad query, source-gated.
        if (
            source_config.web
            and searches_used < max_searches
            and not soft_timeout_hit(research, settings)
        ):
            research_step(
                writer, emissions, "web_search", "running", "Checking current web sources"
            )
            try:
                web_queries = plan_queries.get("web") or [user_text]
                result = await _bounded_external_call(
                    search_web,
                    client,
                    web_queries[0],
                    today=today,
                    max_results=max_results,
                    research=research,
                    settings=settings,
                    caps=caps,
                )
                result["results"] = _filter_school_related_results(
                    result.get("results") or [], schools
                )
                searches_used += 1
                result["results"] = _preserve_extracted_citations(
                    result.get("results") or [], _metadata_by_url(web_evidence)
                )
                annotated = registry.annotate_search_results(result)
                web_evidence.extend(annotated.get("results") or [])
            except Exception:
                logger.debug("web search failed", exc_info=True)
            research_step(
                writer, emissions, "web_search", "complete", "Checking current web sources"
            )

        # Reddit community search — source-gated.
        if (
            source_config.reddit
            and searches_used < max_searches
            and not soft_timeout_hit(research, settings)
        ):
            research_step(
                writer, emissions, "community_search", "running", "Reading student sentiment"
            )
            try:
                from config.settings import load_yaml_asset

                subreddit_menu: list[str] = load_yaml_asset("subreddit_menu") or []
                default_subs = [s for s in subreddit_menu if "{school}" not in str(s)][:3]
                if not default_subs:
                    default_subs = ["ApplyingToCollege"]
                result = await _bounded_external_call(
                    search_reddit,
                    client,
                    (plan_queries.get("reddit") or [user_text])[0],
                    default_subs,
                    allowed=subreddit_menu,
                    today=today,
                    max_results=max_results,
                    research=research,
                    settings=settings,
                    caps=caps,
                )
                searches_used += 1
                annotated = registry.annotate_search_results(result)
                web_evidence.extend(annotated.get("results") or [])
            except Exception:
                logger.debug("reddit search failed", exc_info=True)
            research_step(
                writer, emissions, "community_search", "complete", "Reading student sentiment"
            )

        # GPT-Researcher is supplemental. Run it only after direct gated retrieval
        # has had the first claim on the budget.
        if (
            settings.deep_research_use_gptr
            and (source_config.web or source_config.edu)
            and not soft_timeout_hit(research, settings)
        ):
            official_domains = await _official_domains(deps, schools)
            research_step(
                writer,
                emissions,
                "gptr_research",
                "running",
                "Checking extra sources",
            )
            gptr_budget_s = remaining_time_seconds(
                research,
                float(settings.deep_research_soft_timeout_s),
                reserve_s=15,
                cap_s=float(getattr(settings, "deep_research_gptr_timeout_s", 30)),
            )
            gptr_result: dict[str, Any]
            if gptr_budget_s < 5:
                gptr_result = {
                    "results": [],
                    "cost_usd": None,
                    "unavailable": "time_budget_exhausted",
                }
            else:
                gptr_result = await gather_via_gptr(
                    (plan_queries.get("web") or plan_queries.get("official") or [user_text])[0],
                    source_config,
                    settings,
                    domains=official_domains,
                    today=today,
                    timeout_s=gptr_budget_s,
                )
            if gptr_result.get("unavailable"):
                caps["gptr_unavailable"] = gptr_result["unavailable"]
            if cost := gptr_result.get("cost_usd"):
                _add_external_cost(research, caps, float(cost))
            gptr_raw_results = _filter_school_related_results(
                gptr_result.get("results") or [], schools
            )
            gptr_results = _preserve_extracted_citations(
                gptr_raw_results, _metadata_by_url(web_evidence)
            )
            annotated = registry.annotate_search_results(
                {"results": gptr_results}
            )
            web_evidence.extend(annotated.get("results") or [])
            research_step(
                writer,
                emissions,
                "gptr_research",
                "complete",
                "Checking extra sources",
            )

        # URL extraction — collect top URLs, then extract.
        if extracts_used < max_extracts and not soft_timeout_hit(research, settings):
            top_urls = _top_urls(web_evidence, max_extracts - extracts_used)
            if top_urls:
                research_step(
                    writer, emissions, "extract", "running", "Reading selected pages"
                )
                metadata_by_url = _metadata_by_url(web_evidence)
                extracted = await _bounded_external_call(
                    extract_urls,
                    client,
                    top_urls,
                    today,
                    research=research,
                    settings=settings,
                    caps=caps,
                    cap_s=15,
                )
                extracted = _preserve_extracted_citations(extracted, metadata_by_url)
                extracts_used += len(top_urls)
                annotated_extracted = registry.annotate_search_results(
                    {"results": extracted}
                ).get("results") or []
                web_evidence.extend(annotated_extracted)
                research_step(
                    writer, emissions, "extract", "complete", "Reading selected pages"
                )

    except Exception:
        logger.warning("external gather failed — continuing with partial data", exc_info=True)
        caps["external_unavailable"] = True

    merged_caps = dict(research.get("caps") or {})
    merged_caps.update(caps)
    caps = merged_caps
    caps["tavily_searches_used"] = searches_used
    caps["tavily_extracts_used"] = extracts_used
    research["caps"] = caps
    research["web_evidence"] = web_evidence
    research["emissions"] = emissions
    return {"source_registry": registry.dump(), "research": research}


def _top_urls(evidence: list[Any], limit: int) -> list[str]:
    """Extract up to limit unique URLs, balanced across schools/topics."""
    if limit <= 0:
        return []
    grouped: dict[tuple[str, str], list[str]] = {}
    order: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    for item in evidence:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not isinstance(url, str) or not url or url in seen_urls:
            continue
        seen_urls.add(url)
        key = _coverage_key(item)
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append(url)
    urls: list[str] = []
    while len(urls) < limit:
        added = False
        for key in order:
            bucket = grouped[key]
            if not bucket:
                continue
            urls.append(bucket.pop(0))
            added = True
            if len(urls) >= limit:
                break
        if not added:
            break
    return urls


def _tag_research_context(
    payload: dict[str, Any],
    *,
    school: str | None,
    query: str,
) -> dict[str, Any]:
    """Attach internal school/topic hints to search results for balanced extraction."""
    results = payload.get("results")
    if not isinstance(results, list):
        return payload
    topic = _topic_from_text(query)
    tagged = []
    for item in results:
        if isinstance(item, dict):
            tagged.append(
                {
                    **item,
                    "_research_school": school or "",
                    "_research_topic": topic,
                }
            )
        else:
            tagged.append(item)
    return {**payload, "results": tagged}


def _coverage_key(item: dict[str, Any]) -> tuple[str, str]:
    school = str(item.get("_research_school") or "general").lower()
    topic = str(item.get("_research_topic") or "").lower()
    if not topic:
        topic = _topic_from_text(
            " ".join(
                str(item.get(key) or "")
                for key in ("title", "snippet", "url")
            )
        )
    return (school, topic or "general")


def _filter_school_related_results(
    results: list[Any],
    schools: list[Any],
) -> list[Any]:
    """Keep supplemental results that mention at least one requested school."""
    if not schools:
        return results
    school_aliases = [
        alias
        for school in schools
        for alias in _school_aliases(str(school))
    ]
    if not school_aliases:
        return results
    filtered: list[Any] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        text = " ".join(
            str(item.get(key) or "") for key in ("title", "snippet", "url")
        ).lower()
        if any(_contains_school_alias(text, alias) for alias in school_aliases):
            filtered.append(item)
    return filtered


def _topic_from_text(text: str) -> str:
    lower = text.lower()
    if any(token in lower for token in ("financial", "aid", "cost", "tuition", "scholarship")):
        return "aid"
    if any(token in lower for token in ("sat", "act", "test", "testing", "optional")):
        return "testing"
    if any(token in lower for token in ("computer science", "program", "major", "cs ")):
        return "program"
    if any(token in lower for token in ("admission", "apply", "application", "deadline")):
        return "admissions"
    if "reddit" in lower or "sentiment" in lower:
        return "sentiment"
    return "general"


def _metadata_by_url(evidence: list[Any]) -> dict[str, dict[str, Any]]:
    """First registered URL metadata, used to preserve tiering and coverage tags."""
    metadata_by_url: dict[str, dict[str, Any]] = {}
    for item in evidence:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        citation = item.get("citation")
        if (
            isinstance(url, str)
            and url
            and isinstance(citation, dict)
            and url not in metadata_by_url
        ):
            metadata: dict[str, Any] = {"citation": citation}
            if item.get("_research_school"):
                metadata["_research_school"] = item["_research_school"]
            if item.get("_research_topic"):
                metadata["_research_topic"] = item["_research_topic"]
            metadata_by_url[url] = metadata
    return metadata_by_url


def _preserve_extracted_citations(
    extracted: list[dict[str, Any]],
    metadata_by_url: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep school-site citations from search results on extracted page content."""
    preserved: list[dict[str, Any]] = []
    for item in extracted:
        url = item.get("url")
        if isinstance(url, str) and url in metadata_by_url:
            metadata = metadata_by_url[url]
            if {"source", "tier", "vintage"} <= metadata.keys():
                # Backward-compatible path for tests/callers passing citation dicts.
                preserved.append({**item, "citation": metadata})
            else:
                preserved.append({**item, **metadata})
        else:
            preserved.append(item)
    return preserved


async def _resolve_unitid(deps: Any, school_name: str) -> int | None:
    """Resolve a canonical school name to a unitid for school-site search."""
    try:
        result = await resolve_school(deps.catalog, school_name)
    except Exception:
        return None
    return result.school.unitid if isinstance(result, ResolveMatch) else None


async def _official_domains(deps: Any, schools: list[str]) -> list[str]:
    """Official school domains for GPTR domain filtering."""
    domains: list[str] = []
    for school_name in schools:
        unitid = await _resolve_unitid(deps, school_name)
        if unitid is None:
            continue
        domain = deps.catalog.school_domain(unitid)
        if domain and domain not in domains:
            domains.append(domain)
    return domains


def _add_external_cost(research: dict[str, Any], caps: dict[str, Any], cost: float) -> None:
    """Add a non-token external research cost estimate to the usage payload."""
    usage = dict(research.get("usage") or {})
    current = usage.get("est_cost_usd")
    usage.setdefault("input_tokens", 0)
    usage.setdefault("output_tokens", 0)
    usage.setdefault("tool_calls", 0)
    usage["est_cost_usd"] = float(current or 0.0) + cost
    research["usage"] = usage
    caps["est_cost_usd"] = usage["est_cost_usd"]


async def _bounded_external_call(
    func: Any,
    *args: Any,
    research: dict[str, Any],
    settings: Any,
    caps: dict[str, Any],
    cap_s: float = 12,
    **kwargs: Any,
) -> Any:
    """Run one external search/extract call inside the remaining research budget."""
    timeout = remaining_time_seconds(
        research,
        float(settings.deep_research_soft_timeout_s),
        reserve_s=10,
        cap_s=cap_s,
    )
    if timeout < 1:
        caps["external_timeout"] = True
        raise TimeoutError("external research budget exhausted")
    try:
        return await asyncio.wait_for(func(*args, **kwargs), timeout=timeout)
    except TimeoutError:
        caps["external_timeout"] = True
        raise


def _queries_by_source(plan: dict[str, Any]) -> dict[str, list[str]]:
    """Planned queries grouped by source type."""
    research_plan = plan.get("research_plan") or {}
    grouped: dict[str, list[str]] = {}
    if not isinstance(research_plan, dict):
        return grouped
    for task in research_plan.get("tasks") or []:
        if not isinstance(task, dict):
            continue
        queries = [q for q in (task.get("queries") or []) if isinstance(q, str) and q.strip()]
        if not queries:
            continue
        for source in task.get("sources") or []:
            if source not in {"official", "web", "reddit"}:
                continue
            grouped.setdefault(source, [])
            for query in queries:
                if query not in grouped[source]:
                    grouped[source].append(query)
    return grouped


def _per_school_query_limit(max_searches: int, searches_used: int, schools: list[Any]) -> int:
    """Fair official-query budget per resolved school."""
    remaining = max(0, max_searches - searches_used)
    school_count = max(1, len(schools))
    return max(1, min(4, remaining // school_count or 1))


def _official_search_budget(
    max_searches: int,
    searches_used: int,
    source_config: SourceConfig,
) -> int:
    """Official-search budget after reserving enabled supplemental source calls."""
    reserved = int(source_config.web) + int(source_config.reddit)
    return max(0, max_searches - searches_used - reserved)


def _official_queries_for_school(
    plan: dict[str, Any],
    grouped_queries: dict[str, list[str]],
    school_name: str,
) -> list[str]:
    """Return official-source queries scoped to one school.

    The planner often creates useful school-specific queries, but aliases differ
    from DB canonical names ("MIT" vs "Massachusetts Institute of Technology").
    Prefer a topic-aware query built from the resolved school name, then include
    planner queries that mention one of the school's aliases.
    """
    queries: list[str] = []
    research_plan = plan.get("research_plan") or {}
    topics: list[str] = []
    if isinstance(research_plan, dict):
        topics = [str(t).strip() for t in (research_plan.get("topics") or []) if str(t).strip()]
    queries.extend(_topic_official_queries(school_name, topics))

    aliases = _school_aliases(school_name)
    for query in grouped_queries.get("official") or []:
        lower = query.lower()
        if any(alias in lower for alias in aliases) and query not in queries:
            queries.append(query)

    if not queries:
        queries.append(f"{school_name} undergraduate admissions financial aid test policy")
    return queries


def _topic_official_queries(school_name: str, topics: list[str]) -> list[str]:
    """Build reliable official-source searches from normalized plan topics."""
    queries: list[str] = []
    topic_text = " ".join(topic.lower() for topic in topics)
    if not topic_text:
        return []
    has_admissions = any(
        token in topic_text for token in ("admission", "apply", "application")
    )
    has_program = "computer" in topic_text or "program" in topic_text or "major" in topic_text
    has_test = "test" in topic_text or "sat" in topic_text or "act" in topic_text
    has_aid = any(
        token in topic_text
        for token in ("aid", "financial", "cost", "tuition", "scholarship")
    )

    if has_admissions and has_program:
        queries.append(f"{school_name} computer science undergraduate admissions requirements")
    elif has_admissions:
        queries.append(f"{school_name} undergraduate admissions requirements")

    if has_aid:
        queries.append(
            f"{school_name} undergraduate financial aid grants cost of attendance"
        )
    if has_test:
        queries.append(f"{school_name} undergraduate SAT ACT test policy")
    if has_program and not has_admissions:
        queries.append(f"{school_name} computer science undergraduate admissions")
    if has_admissions and has_program:
        queries.append(f"{school_name} undergraduate admissions requirements")
    return queries


def _school_aliases(school_name: str) -> set[str]:
    """Simple aliases for matching planner queries to a resolved school."""
    words = re.findall(r"[A-Za-z]+", school_name)
    aliases = {school_name.lower()}
    if words:
        aliases.add(words[0].lower())
    meaningful = [
        word
        for word in words
        if word.lower() not in {"of", "the", "and", "university", "college"}
    ]
    if meaningful:
        aliases.add(" ".join(word.lower() for word in meaningful))
        aliases.add(meaningful[0].lower())
        acronym = "".join(word[0] for word in meaningful).lower()
        if len(acronym) > 1:
            aliases.add(acronym)
    return {alias for alias in aliases if alias}


def _contains_school_alias(text: str, alias: str) -> bool:
    if not alias:
        return False
    if len(alias) <= 4:
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", text))
    return alias in text
