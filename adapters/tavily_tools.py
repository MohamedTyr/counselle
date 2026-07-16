"""Three Tavily search tools for Counselle (ADR 0015, Slice C).

All three are **pure async functions** — no pydantic-ai imports, no PydanticAI
deps. Slice B mounts them as FunctionToolset tools and injects the deps. Each
function takes explicit deps so it can be called in unit tests with simple stubs.

Return shape on success:
    {"results": [{"title": str, "url": str, "snippet": str, "citation": dict}],
     "freshness": {"current": int, "historical": int, "undated": int, "guidance": str}}

Return shape on error (never raises):
    {"error": str, "retryable": bool}

Source registry marker logic ("[n]") is added by Slice B's post-tool hook, not here.
"""

from __future__ import annotations

import os
import re
from datetime import date
from typing import Any
from urllib.parse import urlparse

from tavily import AsyncTavilyClient
from tavily.errors import (
    BadRequestError,
    ForbiddenError,
    InvalidAPIKeyError,
    UsageLimitExceededError,
)

from domain.envelope import Citation
from domain.urls import registrable_domain as _registrable_domain

# A leading-underscore re-import is treated by mypy as non-exported unless it is
# named in __all__. The test suite and the schema-search docs import these names
# from this module, so declare the public surface explicitly (keeps `mypy .` green).
__all__ = [
    "REDDIT_DOMAINS",
    "make_tavily_client",
    "search_web",
    "search_school_site",
    "search_reddit",
    "_registrable_domain",
    "_safe_error",
    "_subreddits_allowed",
]

# ---------------------------------------------------------------------------
# Domain helpers
# ---------------------------------------------------------------------------

_GOV_TLDS = frozenset({"gov", "mil"})
REDDIT_DOMAINS = ("reddit.com", "redd.it")

#: Infra-shaped content in exception messages (defense-in-depth for SDK
#: messages that may embed hosts, accounts, or addresses): a bare IPv4 or an
#: email-like token suppresses the raw message — see ``_safe_error``.
_IPV4_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
_ACADEMIC_PERIOD_RE = re.compile(
    r"\b(?P<start>20\d{2})\s*(?P<sep>[-–—/])\s*(?P<end>(?:20)?\d{2})\b"
)
_YEAR_RE = re.compile(r"\b20\d{2}\b")
_COPYRIGHT_YEAR_RE = re.compile(r"(?:copyright|©)\s*(?:20\d{2})", re.IGNORECASE)
_FRESHNESS_GUIDANCE = (
    "Retrieval date is not source-period evidence. For a current numeric claim, use only a "
    "result marked current whose source_period_evidence supports the claim; otherwise search "
    "the official site again with a year-specific query or say the current value is unavailable."
)


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


def _http_location(url: object) -> tuple[str, str] | None:
    """Return a normalized host/path only for usable HTTP(S) result URLs."""
    if not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().rstrip(".")
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not host:
        return None
    return host, parsed.path


def _host_matches_domain(host: str, domain: str) -> bool:
    candidate = _registrable_domain(domain) or ""
    return bool(candidate) and (host == candidate or host.endswith(f".{candidate}"))


def _web_result_allowed(url: object, excluded_domains: list[str] | None) -> bool:
    location = _http_location(url)
    if location is None:
        return False
    host, _path = location
    return not any(_host_matches_domain(host, domain) for domain in (excluded_domains or ()))


def _reddit_result_allowed(url: object, subreddits: list[str]) -> bool:
    location = _http_location(url)
    if location is None:
        return False
    host, path = location
    if not _host_matches_domain(host, "reddit.com"):
        return False
    parts = [part for part in path.split("/") if part]
    allowed = {subreddit.casefold() for subreddit in subreddits}
    return len(parts) >= 2 and parts[0].casefold() == "r" and parts[1].casefold() in allowed


def _citation_for_web_result(url: str, today: date) -> Citation:
    """Build the strict v2 general-web citation."""
    return Citation(
        source="web",
        tier="official",
        vintage=f"Retrieved {today:%b %d, %Y} (live web)",
        url=url,
    )


def _period_end_year(match: re.Match[str]) -> int:
    start = int(match.group("start"))
    raw_end = match.group("end")
    return int(raw_end) if len(raw_end) == 4 else (start // 100) * 100 + int(raw_end)


def _period_excerpt(text: str, start: int, end: int) -> str:
    left = max(0, start - 90)
    right = min(len(text), end + 150)
    return " ".join(text[left:right].split())[:300]


def _page_period(result: dict[str, Any], today: date) -> dict[str, str | None]:
    """Derive conservative source-period evidence from page text/metadata.

    Academic-year ranges beat standalone years so a modern copyright footer
    cannot make a visibly historical page look current. Raw page content is
    considered only for academic-year ranges; its standalone years are too
    likely to be navigation/footer noise.
    """
    title_and_snippet = "\n".join(
        str(result.get(key) or "") for key in ("title", "content")
    )
    candidates: list[tuple[int, str, str, str]] = []
    for match in _ACADEMIC_PERIOD_RE.finditer(title_and_snippet):
        candidates.append(
            (
                _period_end_year(match),
                match.group(0),
                _period_excerpt(title_and_snippet, match.start(), match.end()),
                "page_content",
            )
        )
    if not candidates:
        without_copyright = _COPYRIGHT_YEAR_RE.sub("", title_and_snippet)
        for match in _YEAR_RE.finditer(without_copyright):
            candidates.append(
                (
                    int(match.group(0)),
                    match.group(0),
                    _period_excerpt(without_copyright, match.start(), match.end()),
                    "page_content",
                )
            )
    if not candidates:
        raw_content = str(result.get("raw_content") or "")
        for match in _ACADEMIC_PERIOD_RE.finditer(raw_content):
            candidates.append(
                (
                    _period_end_year(match),
                    match.group(0),
                    _period_excerpt(raw_content, match.start(), match.end()),
                    "page_content",
                )
            )
    published = str(result.get("published_date") or "")
    published_match = _YEAR_RE.search(published)
    if not candidates and published_match:
        candidates.append(
            (
                int(published_match.group(0)),
                published_match.group(0),
                published[:300],
                "metadata",
            )
        )
    if not candidates:
        return {
            "source_period": None,
            "source_period_basis": None,
            "source_period_evidence": None,
            "source_currentness": "undated",
        }
    end_year, period, evidence, basis = max(candidates, key=lambda item: item[0])
    currentness = "current" if end_year >= today.year else "historical"
    return {
        "source_period": period,
        "source_period_basis": basis,
        "source_period_evidence": evidence,
        "source_currentness": currentness,
    }


def _result_to_item(
    result: dict[str, Any], citation: Citation, today: date | None = None
) -> dict[str, Any]:
    if today is not None:
        citation = citation.model_copy(update=_page_period(result, today))
    return {
        "title": result.get("title", ""),
        "url": result.get("url", ""),
        "snippet": result.get("content", ""),
        "citation": citation.model_dump(),
    }


def _freshness_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {"current": 0, "historical": 0, "undated": 0}
    for item in items:
        currentness = item["citation"].get("source_currentness")
        if currentness in counts:
            counts[currentness] += 1
    return {**counts, "guidance": _FRESHNESS_GUIDANCE}


def _freshness_rank(item: dict[str, Any]) -> int:
    return {"current": 0, "undated": 1, "historical": 2}.get(
        item["citation"].get("source_currentness"), 3
    )


def _institution_search_domain(domain: str) -> str:
    """Widen an institutional ``*.edu`` host to its school-wide base domain."""
    host = (urlparse(f"//{domain}").hostname or domain).lower().rstrip(".")
    labels = host.split(".")
    return ".".join(labels[-2:]) if len(labels) > 2 and labels[-1] == "edu" else host


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
    Reddit source disabled, the toolset passes ``REDDIT_DOMAINS`` so disabled
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

    results = [
        result
        for result in resp.get("results", [])
        if isinstance(result, dict)
        and _web_result_allowed(result.get("url"), exclude_domains)
    ]
    items = [
        _result_to_item(r, _citation_for_web_result(r.get("url", ""), today), today)
        for r in results
    ]
    return {
        "results": items,
        **({"freshness": _freshness_summary(items)} if items else {}),
    }


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

    Resolves the school's official domain from the shared immutable Catalog,
    then passes it to Tavily as an include-domain constraint.

    If neither URL is available in the DB returns ``{"error": ..., "retryable": False}``.
    All other failures return ``{"error": ..., "retryable": True}``.
    """
    domain: str | None = None
    try:
        domain = catalog.school_domain(unitid)
    except Exception as exc:
        return _safe_error(exc)

    if not domain:
        return {"error": "school website unknown", "retryable": False}

    school_site_vintage = f"Retrieved {today:%b %d, %Y} (school's official site)"
    search_domain = _institution_search_domain(domain)
    try:
        resp = await client.search(
            query,
            search_depth="basic",
            max_results=max_results,
            include_domains=[search_domain],
            include_answer=False,
            include_raw_content="text",
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

    requested_domain = search_domain
    items: list[dict[str, Any]] = []
    for result in results:
        url = result.get("url", "")
        actual_host = (urlparse(url).hostname or "").lower().rstrip(".")
        if actual_host == requested_domain or actual_host.endswith(f".{requested_domain}"):
            citation = Citation(
                source="edu", tier="official", vintage=school_site_vintage, url=url
            )
        elif _is_official_domain(url):
            # Tavily's include-domain filter is not a security boundary. A
            # different government/education host is still official web, but
            # never the requested school's official site.
            citation = _citation_for_web_result(url, today)
        else:
            # Third-party leakage does not belong in this official-site tool.
            continue
        items.append(_result_to_item(result, citation, today))
    items.sort(key=_freshness_rank)
    return {
        "results": items,
        **({"freshness": _freshness_summary(items)} if items else {}),
    }


# ---------------------------------------------------------------------------
# Tool 3 — search_reddit
# ---------------------------------------------------------------------------

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

    results = [
        result
        for result in resp.get("results", [])
        if isinstance(result, dict) and _reddit_result_allowed(result.get("url"), valid_subs)
    ]
    items = [
        _result_to_item(
            r,
            Citation(
                source="reddit",
                tier="community",
                vintage=f"Retrieved {today:%b %d, %Y} (Reddit community)",
                url=r.get("url"),
            ),
        )
        for r in results
    ]
    return {"results": items}
