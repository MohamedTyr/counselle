"""Three Tavily search tools for Counselle (ADR 0015, Slice C).

All three are **pure async functions** — no pydantic-ai imports, no PydanticAI
deps. Slice B mounts them as FunctionToolset tools and injects the deps. Each
function takes explicit deps so it can be called in unit tests with simple stubs.

Return shape on success:
    {"results": [{"title": str, "url": str, "snippet": str, "citation": dict}]}

Return shape on error (never raises):
    {"error": str, "retryable": bool}

Source registry marker logic ("[n]") is added by Slice B's post-tool hook, not here.
"""

from __future__ import annotations

import os
import re
from datetime import date
from typing import Any

from tavily import AsyncTavilyClient
from tavily.errors import (
    BadRequestError,
    ForbiddenError,
    InvalidAPIKeyError,
    UsageLimitExceededError,
)

from counselle_db.service import get_values as _get_values_impl
from domain.envelope import Citation
from domain.urls import registrable_domain as _registrable_domain

# A leading-underscore re-import is treated by mypy as non-exported unless it is
# named in __all__. The test suite and the schema-search docs import these names
# from this module, so declare the public surface explicitly (keeps `mypy .` green).
__all__ = [
    "make_tavily_client",
    "search_web",
    "search_school_site",
    "search_reddit",
    "extract_urls",
    "_registrable_domain",
    "_safe_error",
    "_subreddits_allowed",
]

# ---------------------------------------------------------------------------
# Domain helpers
# ---------------------------------------------------------------------------

_GOV_TLDS = frozenset({"gov", "mil"})

#: Infra-shaped content in exception messages (defense-in-depth for SDK
#: messages that may embed hosts, accounts, or addresses): a bare IPv4 or an
#: email-like token suppresses the raw message — see ``_safe_error``.
_IPV4_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


#: ``_registrable_domain`` now lives in ``domain/urls.py`` (shared with the
#: catalog's school-domain loader); imported above as the original private name
#: so existing call sites and tests are unchanged.


def _tld(domain: str) -> str:
    """Return the TLD of a domain (last dot-segment)."""
    return domain.rsplit(".", 1)[-1].lower() if "." in domain else ""


def _is_official_domain(url: str) -> bool:
    """True for .gov, .mil, and .edu registrable domains."""
    domain = _registrable_domain(url) or ""
    tld = _tld(domain)
    return tld in _GOV_TLDS or tld == "edu"


def _citation_for_web_result(url: str, today: date) -> Citation:
    """Build the Citation for a single web result, applying tiering rules."""
    official = _is_official_domain(url)
    return Citation(
        source="edu" if (_tld(_registrable_domain(url) or "") == "edu") else "web",
        tier="official" if official else "community",
        vintage=f"Retrieved {today:%b %d, %Y} (live web)",
        caveat=None if official else "General web source — verify on the school's official site.",
        url=url,
    )


def _result_to_item(result: dict[str, Any], citation: Citation) -> dict[str, Any]:
    return {
        "title": result.get("title", ""),
        "url": result.get("url", ""),
        "snippet": result.get("content", ""),
        "citation": citation.model_dump(),
    }


def _safe_error(exc: Exception) -> dict[str, Any]:
    """Wrap any exception into the standard error envelope — never raises.

    Auth failures (InvalidAPIKeyError, ForbiddenError) are NOT retryable — the
    key is wrong or revoked and retrying will not help.  All other errors are
    retryable (transient network/rate-limit issues).

    Security: if the exception message looks like it carries infrastructure —
    a URL scheme ("://"), the word "password", the Tavily key prefix, an
    email-like token, or a bare IPv4 address — the raw message is suppressed
    (log server-side instead).
    """
    is_auth_failure = isinstance(exc, (InvalidAPIKeyError, ForbiddenError))
    if is_auth_failure:
        return {
            "error": "external search authentication failed — search is unavailable",
            "retryable": False,
        }
    msg = str(exc)
    _msg_lower = msg.lower()
    # Suppress any message that looks like it contains a URL, a password, the
    # Tavily API key prefix ("tvly-"), an email, or an IPv4 — credential and
    # infra details never reach the model or the student.
    if (
        "://" in msg
        or "password" in _msg_lower
        or "tvly-" in _msg_lower
        or _EMAIL_RE.search(msg)
        or _IPV4_RE.search(msg)
    ):
        msg = "internal error — check server logs"
    return {"error": msg, "retryable": True}


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def make_tavily_client(settings: Any) -> AsyncTavilyClient:
    """Build an AsyncTavilyClient from the Counselle settings object.

    Key resolution order:
    1. ``settings.tavily_api_key`` — the single config surface. Its
       ``validation_alias`` accepts BOTH ``COUNSELLE_TAVILY_API_KEY`` and the
       bare ``TAVILY_API_KEY`` (DS-05), so the local-dev convention works through
       Settings, not a side reader.
    2. ``TAVILY_API_KEY`` environment variable — a defensive fallback for a
       settings object built before the env var was set (e.g. duck-typed test
       stubs). There is NO ``.env``-file hand-parser any more.

    Raises ``RuntimeError`` with a clear message if none of the above is set.
    """
    api_key: str | None = getattr(settings, "tavily_api_key", None)
    if not api_key:
        api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Tavily API key missing — set COUNSELLE_TAVILY_API_KEY (or TAVILY_API_KEY) "
            "in your .env before enabling external search."
        )
    return AsyncTavilyClient(api_key=api_key)


# ---------------------------------------------------------------------------
# Tool 1 — search_web
# ---------------------------------------------------------------------------


async def search_web(
    client: AsyncTavilyClient,
    query: str,
    *,
    today: date,
    max_results: int,
    exclude_domains: list[str] | None = None,
) -> dict[str, Any]:
    """General web search via Tavily, no domain filter.

    Tier assignment:
    - .gov/.mil/.edu registrable domains → ``official``, source ``edu`` or ``web``
    - everything else → ``community`` with the standard web caveat

    ``exclude_domains`` enforces source gating in code (ADR 0013): with the
    Reddit source disabled, the toolset passes ``["reddit.com"]`` so disabled
    sources cannot leak back in through the open web search.

    Returns ``{"results": [...]}`` on success or ``{"error": ..., "retryable": True}``
    on any Tavily/network error.
    """
    try:
        resp = await client.search(
            query,
            search_depth="basic",
            max_results=max_results,
            exclude_domains=exclude_domains,
            include_answer=False,
        )
    except (
        UsageLimitExceededError,
        InvalidAPIKeyError,
        BadRequestError,
        ForbiddenError,
        Exception,
    ) as exc:
        return _safe_error(exc)

    results = resp.get("results", [])
    items = [_result_to_item(r, _citation_for_web_result(r.get("url", ""), today)) for r in results]
    return {"results": items}


# ---------------------------------------------------------------------------
# Tool 2 — search_school_site
# ---------------------------------------------------------------------------


async def search_school_site(
    client: AsyncTavilyClient,
    catalog: Any,
    unitid: int,
    query: str,
    *,
    today: date,
    max_results: int,
) -> dict[str, Any]:
    """Search the school's own .edu (or official) domain via Tavily.

    Resolves the school's website domain from the DB by calling
    ``counselle_db.service.get_values`` for ``institution.admissions_url``,
    ``institution.financial_aid_url``, ``institution.net_price_calculator``,
    and ``institution.website``. The query decides which official host is most
    useful: admissions/test queries prefer the admissions host, aid/cost queries
    prefer the financial-aid or net-price host, and the broad website host is
    only the fallback.

    If neither URL is available in the DB returns ``{"error": ..., "retryable": False}``.
    All other failures return ``{"error": ..., "retryable": True}``.
    """
    domains: list[str] = []
    try:
        envelopes = await _get_values_impl(
            catalog,
            unitid,
            [
                "institution.admissions_url",
                "institution.financial_aid_url",
                "institution.net_price_calculator",
                "institution.website",
            ],
        )
        domains = _school_search_domains(envelopes, query)
    except Exception as exc:
        return _safe_error(exc)

    if not domains:
        return {"error": "school website unknown", "retryable": False}

    school_site_vintage = f"Retrieved {today:%b %d, %Y} (school's official site)"
    try:
        resp = await client.search(
            query,
            search_depth="basic",
            max_results=max_results,
            include_domains=domains,
            include_answer=False,
        )
    except (
        UsageLimitExceededError,
        InvalidAPIKeyError,
        BadRequestError,
        ForbiddenError,
        Exception,
    ) as exc:
        return _safe_error(exc)

    results = resp.get("results", [])

    def _citation_for_school_result(url: str) -> Citation:
        return Citation(
            source="edu",
            tier="official",
            vintage=school_site_vintage,
            url=url,
        )

    items = [
        _result_to_item(r, _citation_for_school_result(r.get("url", "")))
        for r in results
        if _registrable_domain(r.get("url", "")) in domains
    ]
    return {"results": items}


def _school_search_domains(envelopes: list[Any], query: str) -> list[str]:
    """Pick official hosts for a school-site query from DB URL envelopes."""
    grouped: dict[str, list[str]] = {"admissions": [], "aid": [], "website": []}
    for env in envelopes:
        field = getattr(env, "field", "")
        raw_url = getattr(env, "raw", None) or getattr(env, "display", None)
        if raw_url is None or str(raw_url).strip().lower() in {"", "not available"}:
            continue
        domain = _registrable_domain(str(raw_url))
        if domain is None:
            continue
        if field == "institution.admissions_url":
            grouped["admissions"].append(domain)
        elif field in {"institution.financial_aid_url", "institution.net_price_calculator"}:
            grouped["aid"].append(domain)
        elif field == "institution.website":
            grouped["website"].append(domain)

    if _query_is_financial_aid(query):
        return _unique_domains(grouped["aid"] or grouped["website"] or grouped["admissions"])
    return _unique_domains(grouped["admissions"] or grouped["website"] or grouped["aid"])


def _query_is_financial_aid(query: str) -> bool:
    """True when an official query is about cost or aid rather than admissions mechanics."""
    lower = query.lower()
    return any(
        token in lower
        for token in (
            "aid",
            "financial",
            "tuition",
            "cost",
            "net price",
            "scholarship",
            "fafsa",
            "css profile",
        )
    )


def _unique_domains(domains: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for domain in domains:
        if domain in seen:
            continue
        seen.add(domain)
        unique.append(domain)
    return unique


# ---------------------------------------------------------------------------
# Tool 3 — search_reddit
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Tool 0 — extract_urls (research pipeline only)
# ---------------------------------------------------------------------------


async def extract_urls(
    client: AsyncTavilyClient,
    urls: list[str],
    today: date,
    *,
    source: str = "web",
) -> list[dict[str, Any]]:
    """Extract content from URLs via Tavily. Returns citation-shaped dicts.

    Used by the research gather_external node to read full page content.
    The response field from Tavily is ``raw_content`` (not ``content``).
    Returns an empty list on any failure — the caller should continue.
    """
    if not urls:
        return []
    try:
        result = await client.extract(urls=urls)
        results = result.get("results") or []
        items = []
        for r in results:
            if not r.get("url"):
                continue
            citation = _citation_for_web_result(r["url"], today)
            items.append(
                {
                    "title": r.get("url", ""),
                    "url": r["url"],
                    "snippet": (r.get("raw_content") or "")[:300],
                    "citation": citation.model_dump(),
                }
            )
        return items
    except Exception:
        return []


_SCHOOL_TEMPLATE_SLOT = "{school}"


def _subreddits_allowed(requested: list[str], allowed: list[str]) -> tuple[list[str], str | None]:
    """Return (valid_subs, error_message_or_None).

    Rules per ADR 0015 + spec:
    - If ``allowed`` contains the ``{school}`` template slot, any subreddit name
      is accepted (school-specific subs are best-effort).
    - All other requested subs must appear in ``allowed`` (case-insensitive match).
    """
    has_school_slot = any(s.strip() == _SCHOOL_TEMPLATE_SLOT for s in allowed)
    allowed_lower = {s.strip().lower() for s in allowed if s.strip() != _SCHOOL_TEMPLATE_SLOT}

    valid: list[str] = []
    rejected: list[str] = []
    for sub in requested:
        if sub.lower() in allowed_lower:
            valid.append(sub)
        elif has_school_slot:
            # School-specific subs are permitted when the menu carries {school}
            valid.append(sub)
        else:
            rejected.append(sub)

    if rejected:
        return [], (
            f"Subreddit(s) not in the allowed menu: {rejected}. Choose from the provided menu."
        )
    return valid, None


async def search_reddit(
    client: AsyncTavilyClient,
    query: str,
    subreddits: list[str],
    *,
    allowed: list[str],
    today: date,
    max_results: int,
) -> dict[str, Any]:
    """Community sentiment search on Reddit via Tavily.

    ``subreddits`` must be a subset of ``allowed`` (the per-request menu).  If
    the allowed list contains the ``{school}`` template slot, any school-specific
    subreddit name is accepted (best-effort per ADR 0015).

    Tier is always ``community`` with the standard Reddit caveat — never cite
    Reddit sentiment as verified fact.

    Returns ``{"results": [...]}`` on success or ``{"error": ..., "retryable": ...}``
    on validation failure or Tavily/network error.
    """
    valid_subs, err = _subreddits_allowed(subreddits, allowed)
    if err:
        return {"error": err, "retryable": False}
    if not valid_subs:
        return {"error": "no valid subreddits after allowlist filtering", "retryable": False}

    include_domains = [f"reddit.com/r/{s}" for s in valid_subs]
    citation = Citation(
        source="reddit",
        tier="community",
        vintage=f"Retrieved {today:%b %d, %Y} (Reddit community)",
        caveat="Community sentiment from Reddit — lived experience, not verified fact.",
    )
    try:
        resp = await client.search(
            query,
            search_depth="basic",
            max_results=max_results,
            include_domains=include_domains,
            include_answer=False,
        )
    except (
        UsageLimitExceededError,
        InvalidAPIKeyError,
        BadRequestError,
        ForbiddenError,
        Exception,
    ) as exc:
        return _safe_error(exc)

    results = resp.get("results", [])
    items = [_result_to_item(r, citation.model_copy(update={"url": r.get("url")})) for r in results]
    return {"results": items}
