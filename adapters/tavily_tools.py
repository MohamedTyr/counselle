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
from datetime import date
from typing import Any
from urllib.parse import urlsplit

from tavily import AsyncTavilyClient
from tavily.errors import (
    BadRequestError,
    ForbiddenError,
    InvalidAPIKeyError,
    UsageLimitExceededError,
)

from counselle_db.service import get_values as _get_values_impl
from domain.envelope import Citation

# ---------------------------------------------------------------------------
# Domain helpers
# ---------------------------------------------------------------------------

_GOV_TLDS = frozenset({"gov", "mil"})


def _registrable_domain(url: str) -> str | None:
    """Extract the registrable domain (eTLD+1 approximation) from a URL.

    Strategy: strip the leading ``www.`` from the netloc — sufficient for the
    school-site tool since school URLs are stored as institutional domains
    (e.g. ``https://www.duke.edu/admissions`` → ``duke.edu``).  The tool never
    needs sub-sub-domain accuracy; a simple netloc-based approach is intentional
    (KISS — no tldextract dependency).
    """
    try:
        parsed = urlsplit(url)
        netloc = parsed.netloc or parsed.path  # bare domains land in .path
        # Drop port if present
        netloc = netloc.split(":")[0].strip()
        if not netloc:
            return None
        # Strip leading www. only (one level)
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc or None
    except Exception:
        return None


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

    Security: if the exception message contains a URL scheme ("://") or the
    word "password" the raw message is suppressed — log server-side instead.
    """
    is_auth_failure = isinstance(exc, (InvalidAPIKeyError, ForbiddenError))
    if is_auth_failure:
        return {
            "error": "external search authentication failed — search is unavailable",
            "retryable": False,
        }
    msg = str(exc)
    _msg_lower = msg.lower()
    if "://" in msg or "password" in _msg_lower:
        msg = "internal error — check server logs"
    return {"error": msg, "retryable": True}


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def make_tavily_client(settings: Any) -> AsyncTavilyClient:
    """Build an AsyncTavilyClient from the Counselle settings object.

    Key resolution order:
    1. ``settings.tavily_api_key`` (loaded from ``COUNSELLE_TAVILY_API_KEY``)
    2. ``TAVILY_API_KEY`` environment variable (what tavily-python reads natively)
    3. ``TAVILY_API_KEY`` entry in the project ``.env`` file (for local dev where
       the key is stored without the ``COUNSELLE_`` prefix)

    Raises ``RuntimeError`` with a clear message if none of the above is set.
    """
    api_key: str | None = getattr(settings, "tavily_api_key", None)
    if not api_key:
        api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        # Last resort: read the .env file directly to support the common local-dev
        # convention of storing TAVILY_API_KEY without the COUNSELLE_ prefix.
        import logging as _logging

        _env_log = _logging.getLogger(__name__)
        try:
            from pathlib import Path

            env_path = Path(".env")
            if env_path.exists():
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line.startswith("#") or not line.startswith("TAVILY_API_KEY="):
                        continue
                    # Strip inline comments and surrounding whitespace.
                    api_key = line.split("=", 1)[1].split("#")[0].strip()
                    _env_log.debug("Tavily API key loaded from .env file")
                    break
        except Exception as _e:
            _env_log.debug("Could not read .env for TAVILY_API_KEY: %s", _e)
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
    ``counselle_db.service.get_values`` for ``institution.website`` and
    ``institution.admissions_url``, then passes ``include_domains=[domain]``
    to Tavily.

    If neither URL is available in the DB returns ``{"error": ..., "retryable": False}``.
    All other failures return ``{"error": ..., "retryable": True}``.
    """
    domain: str | None = None
    try:
        envelopes = await _get_values_impl(
            catalog, unitid, ["institution.website", "institution.admissions_url"]
        )
        for env in envelopes:
            raw_url = getattr(env, "raw", None) or getattr(env, "display", None)
            if raw_url and str(raw_url) not in ("", "not available"):
                candidate = _registrable_domain(str(raw_url))
                if candidate:
                    domain = candidate
                    break
    except Exception as exc:
        return _safe_error(exc)

    if not domain:
        return {"error": "school website unknown", "retryable": False}

    citation = Citation(
        source="edu",
        tier="official",
        vintage=f"Retrieved {today:%b %d, %Y} (school's official site)",
        url=f"https://{domain}",
    )
    try:
        resp = await client.search(
            query,
            search_depth="basic",
            max_results=max_results,
            include_domains=[domain],
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
    items = [
        _result_to_item(r, citation.model_copy(update={"url": r.get("url", f"https://{domain}")}))
        for r in results
    ]
    return {"results": items}


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
