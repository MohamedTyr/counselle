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
from typing import Any, cast

from langgraph.config import get_stream_writer
from pydantic import ValidationError

from adapters.tavily_tools import (
    extract_urls,
    make_tavily_client,
    search_reddit,
    search_school_site,
    search_web,
)
from app.research.caps import remaining_time_seconds, soft_timeout_hit
from app.research.gptr_adapter import gather_via_gptr
from app.research.models import EvidenceItem
from app.research.steps import research_step
from app.sources import SourceRegistry
from config.settings import get_settings
from counselle_db.models import ResolveMatch
from counselle_db.service import resolve_school
from domain.events import StepDetail, StepSource
from domain.specs import SourceConfig
from domain.urls import favicon_url, registrable_domain

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

    web_evidence: list[dict[str, Any]] = []

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

        evidence_lock = asyncio.Lock()
        search_count_lock = asyncio.Lock()
        parallel_limit = max(1, int(getattr(settings, "deep_research_max_parallel_tasks", 4)))
        semaphore = asyncio.Semaphore(parallel_limit)
        official_done = asyncio.Event()
        phase_tasks: list[Any] = []

        official_budget = 0
        if source_config.edu and searches_used < max_searches:
            official_budget = _official_search_budget(max_searches, searches_used, source_config)
        supplemental_slots = max(0, max_searches - searches_used - official_budget)
        web_slot = bool(source_config.web and supplemental_slots > 0)
        if web_slot:
            supplemental_slots -= 1
        reddit_slot = bool(source_config.reddit and supplemental_slots > 0)

        async def run_official_phase() -> None:
            nonlocal searches_used
            if (
                official_budget <= 0
                or soft_timeout_hit(research, settings)
                or _cost_ceiling_hit(research, caps, settings)
            ):
                return
            research_step(
                writer,
                emissions,
                "official_search",
                "running",
                "Checking official pages",
                kind="edu_search",
                tier="official",
            )
            official_phase_evidence: list[dict[str, Any]] = []
            official_queries_run: list[str] = []
            local_searches = 0
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
                    if local_searches >= official_budget or soft_timeout_hit(research, settings):
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
                    except Exception:
                        logger.debug("official search failed for %r", school_name, exc_info=True)
                        continue
                    local_searches += 1
                    result = _tag_research_context(result, school=school_name, query=query)
                    async with evidence_lock:
                        annotated = registry.annotate_search_results(result)
                        evidence = _evidence_items_from_search_results(
                            annotated.get("results") or [],
                            retrieved_at=today_str,
                            default_school=school_name,
                            default_topic=_topic_from_text(query),
                        )
                        web_evidence.extend(evidence)
                    official_phase_evidence.extend(evidence)
                    official_queries_run.append(query)
            async with search_count_lock:
                searches_used += local_searches
            research_step(
                writer,
                emissions,
                "official_search",
                "complete",
                "Checking official pages",
                detail=_search_detail(official_queries_run, official_phase_evidence),
                sources=_step_sources_from_evidence(official_phase_evidence, reddit_labels=False),
                kind="edu_search",
                tier="official",
            )

        async def run_web_phase() -> None:
            nonlocal searches_used
            if (
                not web_slot
                or soft_timeout_hit(research, settings)
                or _cost_ceiling_hit(research, caps, settings)
            ):
                return
            research_step(
                writer,
                emissions,
                "web_search",
                "running",
                "Checking current web sources",
                kind="web_search",
            )
            web_phase_evidence: list[dict[str, Any]] = []
            web_query = ""
            try:
                web_query = (plan_queries.get("web") or [user_text])[0]
                result = await _bounded_external_call(
                    search_web,
                    client,
                    web_query,
                    today=today,
                    max_results=max_results,
                    exclude_domains=["reddit.com"],
                    research=research,
                    settings=settings,
                    caps=caps,
                )
                result["results"] = _filter_school_related_results(
                    result.get("results") or [], schools
                )
                async with search_count_lock:
                    searches_used += 1
                if source_config.edu and official_budget > 0:
                    await official_done.wait()
                async with evidence_lock:
                    result["results"] = _preserve_extracted_citations(
                        result.get("results") or [], _metadata_by_url(web_evidence)
                    )
                    annotated = registry.annotate_search_results(result)
                    web_phase_evidence = _evidence_items_from_search_results(
                        annotated.get("results") or [],
                        retrieved_at=today_str,
                        default_topic=_topic_from_text(web_query),
                    )
                    web_evidence.extend(web_phase_evidence)
            except Exception:
                logger.debug("web search failed", exc_info=True)
            research_step(
                writer,
                emissions,
                "web_search",
                "complete",
                "Checking current web sources",
                detail=_search_detail([web_query] if web_query else [], web_phase_evidence),
                sources=_step_sources_from_evidence(web_phase_evidence, reddit_labels=False),
                kind="web_search",
            )

        async def run_reddit_phase() -> None:
            nonlocal searches_used
            if (
                not reddit_slot
                or soft_timeout_hit(research, settings)
                or _cost_ceiling_hit(research, caps, settings)
            ):
                return
            research_step(
                writer,
                emissions,
                "community_search",
                "running",
                "Reading student sentiment",
                kind="reddit_search",
                tier="community",
            )
            reddit_phase_evidence: list[dict[str, Any]] = []
            reddit_query = ""
            try:
                from config.settings import load_yaml_asset

                subreddit_menu: list[str] = load_yaml_asset("subreddit_menu") or []
                default_subs = [s for s in subreddit_menu if "{school}" not in str(s)][:3]
                if not default_subs:
                    default_subs = ["ApplyingToCollege"]
                reddit_query = (plan_queries.get("reddit") or [user_text])[0]
                result = await _bounded_external_call(
                    search_reddit,
                    client,
                    reddit_query,
                    default_subs,
                    allowed=subreddit_menu,
                    today=today,
                    max_results=max_results,
                    research=research,
                    settings=settings,
                    caps=caps,
                )
                async with search_count_lock:
                    searches_used += 1
                async with evidence_lock:
                    annotated = registry.annotate_search_results(result)
                    reddit_phase_evidence = _evidence_items_from_search_results(
                        annotated.get("results") or [],
                        retrieved_at=today_str,
                        default_topic="sentiment",
                    )
                    web_evidence.extend(reddit_phase_evidence)
            except Exception:
                logger.debug("reddit search failed", exc_info=True)
            research_step(
                writer,
                emissions,
                "community_search",
                "complete",
                "Reading student sentiment",
                detail=_search_detail(
                    [reddit_query] if reddit_query else [], reddit_phase_evidence
                ),
                sources=_step_sources_from_evidence(reddit_phase_evidence, reddit_labels=True),
                kind="reddit_search",
                tier="community",
            )

        async def run_gptr_phase() -> None:
            if (
                not settings.deep_research_use_gptr
                or not (source_config.web or source_config.edu)
                or soft_timeout_hit(research, settings)
                or _cost_ceiling_hit(research, caps, settings)
            ):
                return
            official_domains = await _official_domains(deps, schools)
            research_step(
                writer,
                emissions,
                "gptr_research",
                "running",
                "Checking extra sources",
                kind="web_search",
            )
            gptr_query = (plan_queries.get("web") or plan_queries.get("official") or [user_text])[0]
            gptr_budget_s = remaining_time_seconds(
                research,
                float(settings.deep_research_soft_timeout_s),
                reserve_s=15,
                cap_s=float(getattr(settings, "deep_research_gptr_timeout_s", 30)),
            )
            if gptr_budget_s < 5:
                gptr_result: dict[str, Any] = {
                    "results": [],
                    "cost_usd": None,
                    "unavailable": "time_budget_exhausted",
                }
            else:
                try:
                    gptr_result = await gather_via_gptr(
                        gptr_query,
                        source_config,
                        settings,
                        domains=official_domains,
                        today=today,
                        timeout_s=gptr_budget_s,
                    )
                except Exception as exc:
                    logger.debug("gptr gather failed", exc_info=True)
                    gptr_result = {
                        "results": [],
                        "cost_usd": None,
                        "unavailable": type(exc).__name__,
                    }
            if gptr_result.get("unavailable"):
                caps["gptr_unavailable"] = gptr_result["unavailable"]
            if cost := gptr_result.get("cost_usd"):
                _add_external_cost(research, caps, float(cost))
                _cost_ceiling_hit(research, caps, settings)
            gptr_raw_results = _filter_school_related_results(
                gptr_result.get("results") or [], schools
            )
            if source_config.edu and official_budget > 0:
                await official_done.wait()
            async with evidence_lock:
                gptr_results = _preserve_extracted_citations(
                    gptr_raw_results, _metadata_by_url(web_evidence)
                )
                annotated = registry.annotate_search_results({"results": gptr_results})
                gptr_phase_evidence = _evidence_items_from_search_results(
                    annotated.get("results") or [],
                    retrieved_at=today_str,
                    default_topic=_topic_from_text(gptr_query),
                )
                web_evidence.extend(gptr_phase_evidence)
            research_step(
                writer,
                emissions,
                "gptr_research",
                "complete",
                "Checking extra sources",
                detail=_search_detail([gptr_query], gptr_phase_evidence),
                sources=_step_sources_from_evidence(gptr_phase_evidence, reddit_labels=False),
                kind="web_search",
            )

        async def run_official_phase_done() -> None:
            try:
                await run_official_phase()
            finally:
                official_done.set()

        if source_config.edu:
            phase_tasks.append(_run_limited(semaphore, run_official_phase_done()))
        else:
            official_done.set()
        if source_config.web:
            phase_tasks.append(_run_limited(semaphore, run_web_phase()))
        if source_config.reddit:
            phase_tasks.append(_run_limited(semaphore, run_reddit_phase()))
        if settings.deep_research_use_gptr:
            phase_tasks.append(_run_limited(semaphore, run_gptr_phase()))
        if phase_tasks:
            await asyncio.gather(*phase_tasks)

        # URL extraction — collect top URLs, then extract.
        if (
            extracts_used < max_extracts
            and not soft_timeout_hit(research, settings)
            and not _cost_ceiling_hit(research, caps, settings)
        ):
            top_urls = _top_urls(web_evidence, max_extracts - extracts_used)
            if top_urls:
                research_step(
                    writer,
                    emissions,
                    "extract",
                    "running",
                    "Reading selected pages",
                    kind="web_search",
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
                extracted_evidence = _evidence_items_from_search_results(
                    annotated_extracted,
                    retrieved_at=today_str,
                )
                web_evidence.extend(extracted_evidence)
                research_step(
                    writer,
                    emissions,
                    "extract",
                    "complete",
                    "Reading selected pages",
                    detail=StepDetail(
                        query=f"{len(top_urls)} selected URLs",
                        result_count=len(extracted_evidence),
                        domains=_domains_from_evidence(extracted_evidence),
                    ),
                    sources=_step_sources_from_evidence(
                        extracted_evidence, reddit_labels=False
                    ),
                    kind="web_search",
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


async def _run_limited(semaphore: asyncio.Semaphore, coro: Any) -> Any:
    async with semaphore:
        return await coro


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
    school = str(item.get("school") or item.get("_research_school") or "general").lower()
    topic = str(item.get("topic") or item.get("_research_topic") or "").lower()
    if not topic:
        topic = _topic_from_text(
            " ".join(
                str(item.get(key) or "")
                for key in ("title", "snippet", "url")
            )
        )
    return (school, topic or "general")


def _evidence_items_from_search_results(
    results: list[Any],
    *,
    retrieved_at: str,
    default_school: str | None = None,
    default_topic: str | None = None,
) -> list[dict[str, Any]]:
    """Convert annotated Tavily/GPTR result dicts to EvidenceItem state dicts."""
    evidence: list[dict[str, Any]] = []
    for result in results:
        if not isinstance(result, dict):
            continue
        citation = result.get("citation")
        marker = result.get("marker")
        if not _citation_shaped(citation) or not isinstance(marker, str):
            continue
        citation = cast(dict[str, Any], citation)
        title = _str_or_none(result.get("title"))
        snippet = _str_or_none(result.get("snippet"))
        url = _str_or_none(result.get("url") or citation.get("url"))
        school = _str_or_none(result.get("_research_school")) or default_school
        topic = _str_or_none(result.get("_research_topic")) or default_topic
        if topic is None:
            topic = _topic_from_text(
                " ".join(str(result.get(k) or "") for k in ("title", "snippet", "url"))
            )
        try:
            item = EvidenceItem(
                marker=marker,
                source=citation["source"],
                tier=citation["tier"],
                school=school,
                topic=topic,
                title=title,
                snippet=snippet,
                url=url,
                field_key=None,
                display=snippet,
                vintage=str(citation["vintage"]),
                retrieved_at=retrieved_at,
                provenance={
                    "kind": "search_result",
                    "citation": citation,
                    "caveat": citation.get("caveat"),
                    "raw_table": citation.get("raw_table"),
                },
            )
        except ValidationError:
            logger.debug("skipping malformed external evidence item", exc_info=True)
            continue
        evidence.append(item.model_dump(mode="json"))
    return evidence


def _search_detail(queries: list[str], evidence: list[dict[str, Any]]) -> StepDetail:
    query = None
    cleaned_queries = [query for query in queries if query]
    if len(cleaned_queries) == 1:
        query = cleaned_queries[0]
    elif cleaned_queries:
        query = f"{len(cleaned_queries)} searches"
    return StepDetail(
        query=query,
        domains=_domains_from_evidence(evidence),
        result_count=len(evidence),
    )


def _step_sources_from_evidence(
    evidence: list[dict[str, Any]],
    *,
    reddit_labels: bool,
) -> list[StepSource] | None:
    out: list[StepSource] = []
    seen: set[str] = set()
    for item in evidence:
        url = item.get("url")
        if not isinstance(url, str) or not url or url in seen:
            continue
        if not url.lower().startswith(("http://", "https://")):
            continue
        seen.add(url)
        host = registrable_domain(url)
        title = _str_or_none(item.get("title"))
        label = title if reddit_labels and title else (host or title or url)
        out.append(
            StepSource(
                label=label,
                favicon=favicon_url(host) if host else None,
                url=url,
            )
        )
        if len(out) >= 8:
            break
    return out or None


def _domains_from_evidence(evidence: list[dict[str, Any]]) -> list[str] | None:
    domains: list[str] = []
    for item in evidence:
        url = item.get("url")
        if not isinstance(url, str):
            continue
        host = registrable_domain(url)
        if host and host not in domains:
            domains.append(host)
    return domains or None


def _citation_from_evidence(item: dict[str, Any]) -> dict[str, Any] | None:
    provenance = item.get("provenance")
    citation = provenance.get("citation") if isinstance(provenance, dict) else None
    if _citation_shaped(citation):
        return citation
    if not {"source", "tier", "vintage"} <= item.keys():
        return None
    citation = {
        "source": item["source"],
        "tier": item["tier"],
        "vintage": item["vintage"],
    }
    if item.get("url"):
        citation["url"] = item["url"]
    return citation


def _citation_shaped(value: Any) -> bool:
    return isinstance(value, dict) and {"source", "tier", "vintage"} <= value.keys()


def _str_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _filter_school_related_results(
    results: list[Any],
    schools: list[Any],
) -> list[Any]:
    """Keep supplemental results that mention at least one requested school."""
    results = [
        item
        for item in results
        if not (isinstance(item, dict) and _is_reddit_url(_str_or_none(item.get("url"))))
    ]
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


def _is_reddit_url(url: str | None) -> bool:
    if not url:
        return False
    host = registrable_domain(url)
    return host == "reddit.com"


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
        top_level_citation = item.get("citation")
        citation = (
            top_level_citation
            if _citation_shaped(top_level_citation)
            else _citation_from_evidence(item)
        )
        if isinstance(url, str) and url and citation is not None and url not in metadata_by_url:
            metadata: dict[str, Any] = {"citation": citation}
            school = item.get("school") or item.get("_research_school")
            topic = item.get("topic") or item.get("_research_topic")
            if school:
                metadata["_research_school"] = school
            if topic:
                metadata["_research_topic"] = topic
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


def _cost_ceiling_hit(
    research: dict[str, Any],
    caps: dict[str, Any],
    settings: Any,
) -> bool:
    """Mark and return whether estimated research cost has reached its ceiling."""
    ceiling = getattr(settings, "deep_research_max_est_cost_usd", None)
    if ceiling is None:
        return False
    current = _current_est_cost(research, caps)
    if current is None or current < float(ceiling):
        return False
    caps["cost_ceiling_hit"] = True
    research["caps"] = {**dict(research.get("caps") or {}), **caps}
    return True


def _current_est_cost(research: dict[str, Any], caps: dict[str, Any]) -> float | None:
    usage = research.get("usage")
    for value in (
        caps.get("est_cost_usd"),
        usage.get("est_cost_usd") if isinstance(usage, dict) else None,
    ):
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


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
