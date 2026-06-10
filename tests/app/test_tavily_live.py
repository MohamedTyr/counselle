"""Live integration tests for the Tavily search tools.

Marked ``@pytest.mark.live_search`` — these call the real Tavily API and
require a valid Tavily key.  They are skipped automatically when no key is
available, so they never block CI.

Run explicitly with:
    uv run pytest -m live_search -q
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from adapters.tavily_tools import make_tavily_client, search_reddit, search_web
from config.settings import get_settings

TODAY = date.today()
MAX_RESULTS = 5

# ---------------------------------------------------------------------------
# Key availability check (done at collection time — no network call)
# ---------------------------------------------------------------------------


def _has_tavily_key() -> bool:
    """True if a Tavily key is resolvable (settings, env, or .env file)."""
    try:
        settings = get_settings()
        if settings.tavily_api_key:
            return True
    except Exception:
        pass
    if os.environ.get("TAVILY_API_KEY"):
        return True
    env_path = Path(".env")
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("TAVILY_API_KEY=") and not line.startswith("#"):
                return True
    return False


_KEY_AVAILABLE = _has_tavily_key()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MENU_SUBS = [
    "ApplyingToCollege",
    "chanceme",
    "financialaid",
    "premed",
    "csMajors",
    "{school}",
]


@pytest.fixture()
def tavily_client() -> Any:
    """Fresh AsyncTavilyClient per test (avoids stale event-loop issues)."""
    settings = get_settings()
    return make_tavily_client(settings)


# ---------------------------------------------------------------------------
# Live search_web
# ---------------------------------------------------------------------------


@pytest.mark.live_search
@pytest.mark.asyncio
@pytest.mark.skipif(not _KEY_AVAILABLE, reason="TAVILY_API_KEY not set")
async def test_live_search_web_duke_admissions(tavily_client: Any) -> None:
    """search_web returns ≥1 result with a url for a real query."""
    result = await search_web(
        tavily_client,
        "Duke University admissions deadlines",
        today=TODAY,
        max_results=MAX_RESULTS,
    )
    assert "results" in result, f"unexpected error result: {result}"
    assert len(result["results"]) >= 1
    for item in result["results"]:
        assert item["url"], "result must have a url"
        assert "citation" in item
        assert item["citation"]["tier"] in ("official", "community")
        assert item["citation"]["vintage"].startswith("Retrieved")


# ---------------------------------------------------------------------------
# Live search_reddit
# ---------------------------------------------------------------------------


@pytest.mark.live_search
@pytest.mark.asyncio
@pytest.mark.skipif(not _KEY_AVAILABLE, reason="TAVILY_API_KEY not set")
async def test_live_search_reddit_dorms(tavily_client: Any) -> None:
    """search_reddit returns results with reddit.com urls."""
    result = await search_reddit(
        tavily_client,
        "dorms",
        ["ApplyingToCollege"],
        allowed=_MENU_SUBS,
        today=TODAY,
        max_results=MAX_RESULTS,
    )
    assert "results" in result, f"unexpected error result: {result}"
    # Tavily may return 0 results for a narrow domain filter — that's OK
    # but if there are results they must be from reddit.com
    for item in result["results"]:
        assert "reddit.com" in item["url"], f"unexpected URL: {item['url']}"
        assert item["citation"]["tier"] == "community"
        assert item["citation"]["source"] == "reddit"
