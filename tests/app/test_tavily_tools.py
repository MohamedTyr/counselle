"""Unit tests for adapters/tavily_tools.py — NO network calls.

Uses a simple stub class that mirrors the AsyncTavilyClient interface so no
respx/httpx mocking is needed.  All Tavily network I/O is replaced by the stub.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from tavily.errors import ForbiddenError, InvalidAPIKeyError

from adapters.tavily_tools import (
    _registrable_domain,
    _safe_error,
    _subreddits_allowed,
    make_tavily_client,
    search_reddit,
    search_school_site,
    search_web,
)

# ---------------------------------------------------------------------------
# Stub Tavily client
# ---------------------------------------------------------------------------

TODAY = date(2026, 6, 10)
MAX_RESULTS = 5


class StubTavilyClient:
    """Minimal async stand-in for AsyncTavilyClient."""

    def __init__(
        self,
        results: list[dict[str, object]] | None = None,
        raise_exc: Exception | None = None,
    ) -> None:
        self._results = results or []
        self._raise_exc = raise_exc
        self.calls: list[dict[str, object]] = []  # captures kwargs for assertion

    async def search(self, query: str, **kwargs: object) -> dict[str, object]:
        self.calls.append({"query": query, **kwargs})
        if self._raise_exc is not None:
            raise self._raise_exc
        return {"query": query, "results": self._results}


def _make_result(
    url: str, title: str = "Title", content: str = "Snippet text"
) -> dict[str, object]:
    return {"url": url, "title": title, "content": content, "score": 0.9}


# ---------------------------------------------------------------------------
# _registrable_domain
# ---------------------------------------------------------------------------


class TestRegistrableDomain:
    def test_www_stripped(self) -> None:
        assert _registrable_domain("https://www.duke.edu/admissions") == "duke.edu"

    def test_no_www(self) -> None:
        assert _registrable_domain("https://harvard.edu/") == "harvard.edu"

    def test_subdomain_kept(self) -> None:
        # Only leading www. is stripped — deeper subdomains stay
        assert _registrable_domain("https://admissions.mit.edu/apply") == "admissions.mit.edu"

    def test_gov_domain(self) -> None:
        assert _registrable_domain("https://nces.ed.gov/ipeds") == "nces.ed.gov"

    def test_none_on_empty(self) -> None:
        assert _registrable_domain("") is None

    def test_none_on_garbage(self) -> None:
        # bare string treated as netloc-less path
        assert _registrable_domain("not-a-url") == "not-a-url"


# ---------------------------------------------------------------------------
# search_web — tier assignment
# ---------------------------------------------------------------------------


class TestSearchWebTierAssignment:
    @pytest.mark.asyncio
    async def test_edu_domain_gets_official_tier(self) -> None:
        client = StubTavilyClient([_make_result("https://admissions.duke.edu/apply")])
        result = await search_web(client, "Duke admissions", today=TODAY, max_results=MAX_RESULTS)
        assert "results" in result
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "official"
        assert citation["source"] == "edu"
        assert citation["caveat"] is None

    @pytest.mark.asyncio
    async def test_gov_domain_gets_official_tier(self) -> None:
        client = StubTavilyClient([_make_result("https://nces.ed.gov/ipeds")])
        result = await search_web(client, "IPEDS data", today=TODAY, max_results=MAX_RESULTS)
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "official"
        assert citation["source"] == "web"  # .gov → source "web", not "edu"
        assert citation["caveat"] is None

    @pytest.mark.asyncio
    async def test_blog_domain_gets_community_tier(self) -> None:
        client = StubTavilyClient([_make_result("https://collegeknowhow.com/post/123")])
        result = await search_web(client, "college tips", today=TODAY, max_results=MAX_RESULTS)
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "community"
        assert citation["source"] == "web"
        assert "verify on the school's official site" in citation["caveat"]

    @pytest.mark.asyncio
    async def test_vintage_format(self) -> None:
        client = StubTavilyClient([_make_result("https://example.com/")])
        result = await search_web(client, "x", today=TODAY, max_results=MAX_RESULTS)
        vintage = result["results"][0]["citation"]["vintage"]
        assert vintage == "Retrieved Jun 10, 2026 (live web)"

    @pytest.mark.asyncio
    async def test_empty_results(self) -> None:
        client = StubTavilyClient([])
        result = await search_web(client, "nothing", today=TODAY, max_results=MAX_RESULTS)
        assert result == {"results": []}

    @pytest.mark.asyncio
    async def test_client_raises_returns_error_dict(self) -> None:
        client = StubTavilyClient(raise_exc=RuntimeError("network exploded"))
        result = await search_web(client, "q", today=TODAY, max_results=MAX_RESULTS)
        assert "error" in result
        assert result["retryable"] is True
        assert "network exploded" in result["error"]


# ---------------------------------------------------------------------------
# search_school_site — domain resolution
# ---------------------------------------------------------------------------


class FakeCatalog:
    """Minimal catalog stub; get_values is monkeypatched per test."""

    pass


class TestSearchSchoolSite:
    @pytest.mark.asyncio
    async def test_resolves_domain_from_website_field(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from domain.envelope import Citation, CitationEnvelope

        env = CitationEnvelope(
            field="institution.website",
            label="Website",
            display="https://www.duke.edu",
            raw="https://www.duke.edu",
            available=True,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )
        admissions_env = CitationEnvelope(
            field="institution.admissions_url",
            label="Admissions URL",
            display="not available",
            available=False,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )

        async def fake_get_values(catalog: object, unitid: int, keys: list[str]) -> list[object]:
            return [env, admissions_env]

        monkeypatch.setattr("adapters.tavily_tools._get_values_impl", fake_get_values)

        client = StubTavilyClient([_make_result("https://duke.edu/admissions")])
        catalog = FakeCatalog()
        result = await search_school_site(
            client, catalog, 136172, "early decision", today=TODAY, max_results=MAX_RESULTS
        )
        assert "results" in result
        assert len(client.calls) == 1
        assert client.calls[0]["include_domains"] == ["duke.edu"]
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "official"
        assert citation["source"] == "edu"
        assert "school's official site" in citation["vintage"]

    @pytest.mark.asyncio
    async def test_falls_back_to_admissions_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from domain.envelope import Citation, CitationEnvelope

        website_env = CitationEnvelope(
            field="institution.website",
            label="Website",
            display="not available",
            available=False,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )
        admissions_env = CitationEnvelope(
            field="institution.admissions_url",
            label="Admissions URL",
            display="https://www.mit.edu/admissions",
            raw="https://www.mit.edu/admissions",
            available=True,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )

        async def fake_get_values(catalog: object, unitid: int, keys: list[str]) -> list[object]:
            return [website_env, admissions_env]

        monkeypatch.setattr("adapters.tavily_tools._get_values_impl", fake_get_values)

        client = StubTavilyClient([_make_result("https://mit.edu/apply")])
        result = await search_school_site(
            client, FakeCatalog(), 166683, "financial aid", today=TODAY, max_results=MAX_RESULTS
        )
        assert "results" in result
        assert client.calls[0]["include_domains"] == ["mit.edu"]

    @pytest.mark.asyncio
    async def test_returns_error_when_no_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from domain.envelope import Citation, CitationEnvelope

        na_env = CitationEnvelope(
            field="institution.website",
            label="Website",
            display="not available",
            available=False,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )
        na_env2 = CitationEnvelope(
            field="institution.admissions_url",
            label="Admissions URL",
            display="not available",
            available=False,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )

        async def fake_get_values(catalog: object, unitid: int, keys: list[str]) -> list[object]:
            return [na_env, na_env2]

        monkeypatch.setattr("adapters.tavily_tools._get_values_impl", fake_get_values)

        client = StubTavilyClient()
        result = await search_school_site(
            client, FakeCatalog(), 999999, "q", today=TODAY, max_results=MAX_RESULTS
        )
        assert result == {"error": "school website unknown", "retryable": False}
        assert len(client.calls) == 0  # no Tavily call when domain unknown

    @pytest.mark.asyncio
    async def test_tavily_error_returns_error_dict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from domain.envelope import Citation, CitationEnvelope

        env = CitationEnvelope(
            field="institution.website",
            label="Website",
            display="https://uchicago.edu",
            raw="https://uchicago.edu",
            available=True,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )

        async def fake_get_values(catalog: object, unitid: int, keys: list[str]) -> list[object]:
            return [env, env]

        monkeypatch.setattr("adapters.tavily_tools._get_values_impl", fake_get_values)

        client = StubTavilyClient(raise_exc=ConnectionError("timeout"))
        result = await search_school_site(
            client, FakeCatalog(), 144050, "deadlines", today=TODAY, max_results=MAX_RESULTS
        )
        assert "error" in result
        assert result["retryable"] is True

    @staticmethod
    def _patch_duke_domain(monkeypatch: pytest.MonkeyPatch) -> None:
        """Resolve the school domain to duke.edu for the per-result tier tests."""
        from domain.envelope import Citation, CitationEnvelope

        env = CitationEnvelope(
            field="institution.website",
            label="Website",
            display="https://www.duke.edu",
            raw="https://www.duke.edu",
            available=True,
            citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024-25"),
        )

        async def fake_get_values(catalog: object, unitid: int, keys: list[str]) -> list[object]:
            return [env]

        monkeypatch.setattr("adapters.tavily_tools._get_values_impl", fake_get_values)

    @pytest.mark.asyncio
    async def test_on_domain_result_stays_official(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # DS-02: an on-domain result keeps the school's-official-site citation.
        self._patch_duke_domain(monkeypatch)
        client = StubTavilyClient([_make_result("https://duke.edu/admissions")])
        result = await search_school_site(
            client, FakeCatalog(), 198419, "early decision", today=TODAY, max_results=MAX_RESULTS
        )
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "official"
        assert citation["source"] == "edu"
        assert "school's official site" in citation["vintage"]

    @pytest.mark.asyncio
    async def test_off_domain_result_is_retiered_community(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # DS-02: include_domains is a bias, not a guarantee. An off-domain result
        # (a third-party host) must be re-tiered honestly, never stamped official.
        self._patch_duke_domain(monkeypatch)
        client = StubTavilyClient([_make_result("https://collegeconfidential.com/duke")])
        result = await search_school_site(
            client, FakeCatalog(), 198419, "early decision", today=TODAY, max_results=MAX_RESULTS
        )
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "community"
        assert citation["source"] == "web"
        assert citation["tier"] != "official"
        assert "verify on the school's official site" in citation["caveat"]

    @pytest.mark.asyncio
    async def test_off_domain_gov_result_is_official_web(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # DS-02: an off-domain .gov result re-derives correctly to official/web —
        # the tier comes from the actual URL, not the school stamp.
        self._patch_duke_domain(monkeypatch)
        client = StubTavilyClient([_make_result("https://nces.ed.gov/ipeds")])
        result = await search_school_site(
            client, FakeCatalog(), 198419, "outcomes", today=TODAY, max_results=MAX_RESULTS
        )
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "official"
        assert citation["source"] == "web"


# ---------------------------------------------------------------------------
# search_reddit — allowlist enforcement
# ---------------------------------------------------------------------------

_MENU_SUBS = ["ApplyingToCollege", "chanceme", "financialaid", "{school}"]


class TestSearchReddit:
    @pytest.mark.asyncio
    async def test_valid_sub_from_menu(self) -> None:
        client = StubTavilyClient([_make_result("https://reddit.com/r/ApplyingToCollege/post/1")])
        result = await search_reddit(
            client,
            "dorm life",
            ["ApplyingToCollege"],
            allowed=_MENU_SUBS,
            today=TODAY,
            max_results=MAX_RESULTS,
        )
        assert "results" in result
        assert client.calls[0]["include_domains"] == ["reddit.com/r/ApplyingToCollege"]
        citation = result["results"][0]["citation"]
        assert citation["tier"] == "community"
        assert citation["source"] == "reddit"
        assert "lived experience" in citation["caveat"]

    @pytest.mark.asyncio
    async def test_school_specific_sub_allowed_when_slot_present(self) -> None:
        """When {school} slot is in allowed, arbitrary school sub names are permitted."""
        client = StubTavilyClient([_make_result("https://reddit.com/r/Duke/post/1")])
        result = await search_reddit(
            client,
            "Duke dorms",
            ["Duke"],
            allowed=_MENU_SUBS,  # contains {school}
            today=TODAY,
            max_results=MAX_RESULTS,
        )
        assert "results" in result
        assert client.calls[0]["include_domains"] == ["reddit.com/r/Duke"]

    @pytest.mark.asyncio
    async def test_disallowed_sub_returns_error_no_client_call(self) -> None:
        """A sub not in the menu and no {school} slot → error, client never called."""
        client = StubTavilyClient([_make_result("https://reddit.com/r/SomePrivateSub/post/1")])
        no_school_slot_menu = ["ApplyingToCollege", "chanceme"]
        result = await search_reddit(
            client,
            "secret info",
            ["SomePrivateSub"],
            allowed=no_school_slot_menu,
            today=TODAY,
            max_results=MAX_RESULTS,
        )
        assert "error" in result
        assert result["retryable"] is False
        assert len(client.calls) == 0  # no Tavily call

    @pytest.mark.asyncio
    async def test_case_insensitive_match(self) -> None:
        client = StubTavilyClient([_make_result("https://reddit.com/r/financialaid/post/1")])
        result = await search_reddit(
            client,
            "FAFSA tips",
            ["financialaid"],  # exact case
            allowed=["FinancialAid", "chanceme"],  # different case in menu
            today=TODAY,
            max_results=MAX_RESULTS,
        )
        assert "results" in result

    @pytest.mark.asyncio
    async def test_empty_subreddits_after_filter(self) -> None:
        """If all subs are rejected and menu has no {school} slot → error."""
        no_slot_menu = ["ApplyingToCollege"]
        client = StubTavilyClient()
        result = await search_reddit(
            client,
            "q",
            ["NotInMenu"],
            allowed=no_slot_menu,
            today=TODAY,
            max_results=MAX_RESULTS,
        )
        assert "error" in result
        assert result["retryable"] is False
        assert len(client.calls) == 0

    @pytest.mark.asyncio
    async def test_vintage_format(self) -> None:
        client = StubTavilyClient([_make_result("https://reddit.com/r/ApplyingToCollege/x")])
        result = await search_reddit(
            client,
            "q",
            ["ApplyingToCollege"],
            allowed=_MENU_SUBS,
            today=TODAY,
            max_results=MAX_RESULTS,
        )
        vintage = result["results"][0]["citation"]["vintage"]
        assert vintage == "Retrieved Jun 10, 2026 (Reddit community)"

    @pytest.mark.asyncio
    async def test_client_raises_returns_error(self) -> None:
        client = StubTavilyClient(raise_exc=RuntimeError("rate limited"))
        result = await search_reddit(
            client,
            "q",
            ["ApplyingToCollege"],
            allowed=_MENU_SUBS,
            today=TODAY,
            max_results=MAX_RESULTS,
        )
        assert "error" in result
        assert result["retryable"] is True


# ---------------------------------------------------------------------------
# _subreddits_allowed
# ---------------------------------------------------------------------------


class TestSubredditsAllowed:
    def test_exact_match(self) -> None:
        valid, err = _subreddits_allowed(["chanceme"], ["chanceme", "financialaid"])
        assert valid == ["chanceme"]
        assert err is None

    def test_school_slot_allows_any(self) -> None:
        valid, err = _subreddits_allowed(["DukeUniversity"], ["ApplyingToCollege", "{school}"])
        assert valid == ["DukeUniversity"]
        assert err is None

    def test_no_slot_rejects_unknown(self) -> None:
        valid, err = _subreddits_allowed(["Unknown"], ["ApplyingToCollege"])
        assert valid == []
        assert err is not None
        assert "Unknown" in err

    def test_mixed_valid_and_invalid_with_no_slot(self) -> None:
        valid, err = _subreddits_allowed(
            ["ApplyingToCollege", "Invalid"], ["ApplyingToCollege", "chanceme"]
        )
        assert valid == []
        assert err is not None

    def test_empty_requested(self) -> None:
        valid, err = _subreddits_allowed([], ["ApplyingToCollege"])
        assert valid == []
        assert err is None  # nothing requested, nothing rejected


# ---------------------------------------------------------------------------
# make_tavily_client — missing key raises
# ---------------------------------------------------------------------------


class TestMakeTavilyClient:
    def test_raises_when_no_key(self, monkeypatch: pytest.MonkeyPatch, tmp_path: str) -> None:
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("COUNSELLE_TAVILY_API_KEY", raising=False)
        # Change cwd to a temp directory with no .env so the .env fallback is skipped
        monkeypatch.chdir(tmp_path)

        class FakeSettings:
            tavily_api_key = None

        with pytest.raises(RuntimeError, match="Tavily API key missing"):
            make_tavily_client(FakeSettings())

    def test_uses_settings_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)

        class FakeSettings:
            tavily_api_key = "tvly-test-key"

        client = make_tavily_client(FakeSettings())
        assert client is not None

    def test_falls_back_to_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TAVILY_API_KEY", "tvly-env-key")

        class FakeSettings:
            tavily_api_key = None

        client = make_tavily_client(FakeSettings())
        assert client is not None

    def test_no_dotfile_read(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """DS-05: the hand-rolled .env-file reader is gone — a .env present in CWD
        with a key must NOT be read; with no settings/env key, it still raises."""
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("COUNSELLE_TAVILY_API_KEY", raising=False)
        env_file = tmp_path / ".env"
        env_file.write_text("TAVILY_API_KEY=tvly-from-dotfile\n", encoding="utf-8")
        monkeypatch.chdir(tmp_path)

        class FakeSettings:
            tavily_api_key = None

        with pytest.raises(RuntimeError, match="Tavily API key missing"):
            make_tavily_client(FakeSettings())


# ---------------------------------------------------------------------------
# _safe_error — auth failures must not be retryable (fix 1)
# ---------------------------------------------------------------------------


class TestSafeError:
    def test_invalid_api_key_is_not_retryable(self) -> None:
        exc = InvalidAPIKeyError("key rejected")
        result = _safe_error(exc)
        assert result["retryable"] is False
        assert "authentication failed" in result["error"]
        assert "key rejected" not in result["error"]  # raw message must not leak

    def test_forbidden_is_not_retryable(self) -> None:
        exc = ForbiddenError("forbidden")
        result = _safe_error(exc)
        assert result["retryable"] is False
        assert "authentication failed" in result["error"]

    def test_generic_error_is_retryable(self) -> None:
        exc = RuntimeError("connection reset")
        result = _safe_error(exc)
        assert result["retryable"] is True
        assert "connection reset" in result["error"]

    def test_message_containing_url_scheme_is_sanitized(self) -> None:
        exc = RuntimeError("Request failed: https://api.tavily.com/v1/search")
        result = _safe_error(exc)
        assert result["retryable"] is True
        assert "://" not in result["error"]
        assert "internal error" in result["error"]

    def test_message_containing_password_is_sanitized(self) -> None:
        exc = RuntimeError("Bad password in auth header")
        result = _safe_error(exc)
        assert result["retryable"] is True
        assert "password" not in result["error"].lower()
        assert "internal error" in result["error"]

    def test_message_containing_tvly_prefix_is_sanitized(self) -> None:
        # FIX 6: any message containing the Tavily key prefix "tvly-" must be suppressed
        exc = RuntimeError("Auth failed for key tvly-abc123XYZ")
        result = _safe_error(exc)
        assert result["retryable"] is True
        assert "tvly-" not in result["error"].lower()
        assert "internal error" in result["error"]

    def test_message_containing_bare_ipv4_is_sanitized(self) -> None:
        # B1a review fix 9: a bare IPv4 in an SDK message is infra leakage
        exc = RuntimeError("connect to 10.0.12.7 failed: timeout")
        result = _safe_error(exc)
        assert result["retryable"] is True
        assert "10.0.12.7" not in result["error"]
        assert "internal error" in result["error"]

    def test_message_containing_email_is_sanitized(self) -> None:
        # B1a review fix 9: an email-like token in an SDK message is suppressed
        exc = RuntimeError("account ops@counselle.internal is over quota")
        result = _safe_error(exc)
        assert result["retryable"] is True
        assert "@" not in result["error"]
        assert "internal error" in result["error"]

    def test_dotted_version_number_is_not_mistaken_for_an_ip(self) -> None:
        # Three dot-segments (a version) must NOT trigger the IPv4 suppression
        exc = RuntimeError("unsupported client version 1.2.3")
        result = _safe_error(exc)
        assert "unsupported client version 1.2.3" in result["error"]

    def test_message_containing_tvly_prefix_case_insensitive(self) -> None:
        # FIX 6: case-insensitive match ("TVLY-" still triggers suppression)
        exc = RuntimeError("Token TVLY-secret123 invalid")
        result = _safe_error(exc)
        assert "tvly-" not in result["error"].lower()
        assert "internal error" in result["error"]

    @pytest.mark.asyncio
    async def test_search_web_auth_error_is_not_retryable(self) -> None:
        client = StubTavilyClient(raise_exc=InvalidAPIKeyError("bad key"))
        result = await search_web(client, "q", today=TODAY, max_results=MAX_RESULTS)
        assert result["retryable"] is False
        assert "authentication failed" in result["error"]

    @pytest.mark.asyncio
    async def test_search_web_forbidden_is_not_retryable(self) -> None:
        client = StubTavilyClient(raise_exc=ForbiddenError("access denied"))
        result = await search_web(client, "q", today=TODAY, max_results=MAX_RESULTS)
        assert result["retryable"] is False
