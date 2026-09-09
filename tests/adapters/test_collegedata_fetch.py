"""Tests for adapters/collegedata/fetch.py — NO network calls (httpx.MockTransport
throughout). These are the ADR 0038 R0 honesty-and-safety tests: the token
bucket actually rate-limits, `/api/*` is unreachable,
the sitemap loader filters/de-duplicates, and rotation is distinguished from
not-found.
"""

from __future__ import annotations

import asyncio
import gzip
import time
import urllib.robotparser as robotparser
from collections.abc import Callable

import httpx
import pytest

from adapters.collegedata.fetch import (
    AllowedPathViolation,
    BuildIdRotationLimitExceeded,
    CollegeDataFetcher,
    FetchConfig,
    ResponseTooLargeError,
    RobotsDisallowedError,
    TokenBucket,
    TooManyRateLimitBlocks,
    _maybe_gunzip,
    _send,
    match_college_search_url,
    parse_sitemap_locs,
)

BUILD_ID = "zzxGQS7XBwPUcY5oClSu5"

_SITEMAP_INDEX_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    b"<sitemap><loc>https://www.collegedata.com/a-sitemap.xml.gz</loc></sitemap>"
    b"<sitemap><loc>https://www.collegedata.com/b-sitemap.xml.gz</loc></sitemap>"
    b"</sitemapindex>"
)


def _urlset(*locs: str) -> bytes:
    body = "".join(f"<url><loc>{loc}</loc></url>" for loc in locs)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{body}</urlset>"
    ).encode()


def _yale_locs() -> list[str]:
    base = "https://stg.collegedata.com/college-search/Yale-University"
    return [base, *(f"{base}/{tab}" for tab in (
        "admission", "money-matters", "academics", "campus-life", "students"
    ))]


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _allow_all_robots() -> robotparser.RobotFileParser:
    parser = robotparser.RobotFileParser()
    parser.parse([])  # an empty ruleset means "nothing is disallowed"
    return parser


def _fetcher(
    client: httpx.AsyncClient, **config_kwargs: object
) -> CollegeDataFetcher:
    # rps defaults sky-high here (unlike FetchConfig's real production
    # default of 1.0) so these tests aren't gated by the token bucket —
    # TestTokenBucket below is where the bucket's own timing is verified.
    config_kwargs.setdefault("rps", 1000.0)
    config = FetchConfig(
        user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)", **config_kwargs  # type: ignore[arg-type]
    )
    fetcher = CollegeDataFetcher(config, client)
    # Pre-seed an allow-all robots.txt ruleset so tests that don't care
    # about robots.txt (almost all of them) don't need a handler that
    # serves one — TestRobotsCompliance below constructs its own
    # CollegeDataFetcher directly to exercise the live fetch-and-parse path.
    fetcher._robots = _allow_all_robots()
    return fetcher


class TestTokenBucket:
    """Plan §4.1: "one token bucket ... shared by N schools in flight"."""

    async def test_acquire_limits_to_the_configured_rate(self) -> None:
        bucket = TokenBucket(rps=20.0)  # 0.05s interval — fast test, real clock
        start = time.monotonic()
        for _ in range(5):
            await bucket.acquire()
        elapsed = time.monotonic() - start
        # 5 acquisitions at 1/20s apart = 4 waits >= 0.2s; generous upper
        # bound catches an interval that silently multiplied instead.
        assert elapsed >= 0.19
        assert elapsed < 1.0

    async def test_concurrent_acquires_are_serialized_to_the_rate(self) -> None:
        bucket = TokenBucket(rps=20.0)
        start = time.monotonic()
        await asyncio.gather(*(bucket.acquire() for _ in range(5)))
        elapsed = time.monotonic() - start
        assert elapsed >= 0.19

    def test_halve_doubles_the_interval(self) -> None:
        bucket = TokenBucket(rps=10.0)
        assert bucket.rps == pytest.approx(10.0)
        bucket.halve()
        assert bucket.rps == pytest.approx(5.0)
        bucket.halve()
        assert bucket.rps == pytest.approx(2.5)

    def test_halve_never_collapses_to_a_full_stop(self) -> None:
        bucket = TokenBucket(rps=1.0)
        for _ in range(20):
            bucket.halve()
        assert bucket.rps > 0


class TestApiPathGuard:
    """R0/robots.txt: `/api/*` must never be reachable through this module."""

    async def test_send_refuses_an_api_path_before_dispatching(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("the transport must never be reached for /api/*")

        async with _client(handler) as client:
            with pytest.raises(AllowedPathViolation):
                await _send(
                    client,
                    "https://www.collegedata.com/api/college-search",
                    timeout=5.0,
                    follow_redirects=False,
                )

    async def test_send_allows_the_next_data_path(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"ok": True}, request=request)

        async with _client(handler) as client:
            response = await _send(
                client,
                "https://www.collegedata.com/_next/data/x/college-search/yale.json",
                timeout=5.0,
                follow_redirects=False,
            )
        assert response.status_code == 200


class TestSitemapMatching:
    def test_matches_the_overview_and_tab_urls(self) -> None:
        assert match_college_search_url(
            "https://stg.collegedata.com/college-search/Yale-University"
        ) == ("Yale-University", "overview")
        assert match_college_search_url(
            "https://www.collegedata.com/college-search/Yale-University/admission"
        ) == ("Yale-University", "admission")

    def test_rejects_non_college_search_and_scholarship_urls(self) -> None:
        assert match_college_search_url("https://stg.collegedata.com/scholarship-finder/1") is None
        assert match_college_search_url("https://stg.collegedata.com/login") is None

    def test_rejects_unknown_tab_suffixes(self) -> None:
        assert match_college_search_url(
            "https://stg.collegedata.com/college-search/Yale-University/bogus-tab"
        ) is None

    def test_parses_locs_from_xml(self) -> None:
        locs = parse_sitemap_locs(_urlset(*_yale_locs()))
        assert len(locs) == 6


class TestDiscoverSlugs:
    async def test_filters_and_deduplicates(self) -> None:
        # Two schools with all 6 tabs, one duplicate listing (Keiser-style),
        # and the six non-school pages (no tab siblings -> filtered by the
        # "all six tabs present" rule, no NON_SCHOOL_SLUGS special-casing
        # needed).
        a_sitemap = _urlset(
            *_yale_locs(),
            *_yale_locs(),  # duplicate listing, plan D1
            "https://stg.collegedata.com/college-search/help",
            "https://stg.collegedata.com/college-search/michigan",
            "https://stg.collegedata.com/college-tools/college-chances",
        )
        b_sitemap = _urlset("https://www.collegedata.com/college-search/help")

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("sitemap_index.xml"):
                return httpx.Response(200, content=_SITEMAP_INDEX_XML, request=request)
            if url.endswith("a-sitemap.xml.gz"):
                return httpx.Response(200, content=a_sitemap, request=request)
            if url.endswith("b-sitemap.xml.gz"):
                return httpx.Response(200, content=b_sitemap, request=request)
            raise AssertionError(f"unexpected sitemap request: {url}")

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            slugs = await fetcher.discover_slugs()

        assert slugs == ("Yale-University",)

    async def test_handles_gzip_encoded_sitemaps(self) -> None:
        a_sitemap = gzip.compress(_urlset(*_yale_locs()))

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("sitemap_index.xml"):
                return httpx.Response(
                    200,
                    content=(
                        b'<?xml version="1.0"?><sitemapindex '
                        b'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                        b"<sitemap><loc>https://www.collegedata.com/a-sitemap.xml.gz</loc>"
                        b"</sitemap></sitemapindex>"
                    ),
                    request=request,
                )
            return httpx.Response(200, content=a_sitemap, request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            slugs = await fetcher.discover_slugs()

        assert slugs == ("Yale-University",)


async def _instant_sleep(_delay: float, result: object = None) -> object:
    return result


def _patch_out_retry_backoff_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """tenacity's async retry sleeps via `asyncio.sleep` between attempts
    (`tenacity/asyncio/__init__.py::_portable_async_sleep`) — real backoff
    delays have no place in the routine suite, so tests that deliberately
    exhaust the 502 retry make time pass instantly instead."""
    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)


def _html_with_build_id(build_id: str) -> str:
    return f'<html><script>{{"buildId":"{build_id}"}}</script></html>'


class TestBuildIdRotation:
    async def test_404_with_unchanged_build_id_is_not_found(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if "/_next/data/" in url:
                return httpx.Response(404, html="<html>not found</html>", request=request)
            return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            page = await fetcher.fetch_tab("Yale-University", "money-matters")

        assert page.page_status == "not_found"
        assert fetcher.build_id_rotations == 0

    async def test_404_with_a_new_build_id_is_a_rotation_and_retries(self) -> None:
        calls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if "/_next/data/" in url:
                calls.append(url)
                if BUILD_ID in url:
                    return httpx.Response(404, html="<html>stale build</html>", request=request)
                return httpx.Response(
                    200,
                    json={"pageProps": {"profile": {"id": 1, "slug": "Yale-University"}}},
                    request=request,
                )
            # HTML buildId page: first call returns the old id, second the new one.
            build_id = BUILD_ID if len(calls) == 0 else "newBuildId2"
            return httpx.Response(200, text=_html_with_build_id(build_id), request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            assert fetcher.build_id == BUILD_ID
            page = await fetcher.fetch_tab("Yale-University", "money-matters")

        assert page.page_status == "ok"
        assert fetcher.build_id_rotations == 1
        assert fetcher.build_id == "newBuildId2"

    async def test_rotation_limit_exceeded_raises(self) -> None:
        rotation = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal rotation
            url = str(request.url)
            if "/_next/data/" in url:
                return httpx.Response(404, html="<html>stale</html>", request=request)
            rotation += 1
            html = _html_with_build_id(f"build-{rotation}")
            return httpx.Response(200, text=html, request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client, max_build_rotations=2)
            await fetcher.resolve_build_id("Yale-University")
            with pytest.raises(BuildIdRotationLimitExceeded):
                await fetcher.fetch_tab("Yale-University", "money-matters")

        assert fetcher.build_id_rotations == 3


class TestRateLimitBackoff:
    async def test_three_consecutive_blocks_raise_and_halve_the_rate(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if "/_next/data/" in str(request.url):
                return httpx.Response(429, text="slow down", request=request)
            return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            initial_rps = fetcher.current_rps
            with pytest.raises(TooManyRateLimitBlocks):
                for _ in range(3):
                    await fetcher.fetch_tab("Yale-University", "money-matters")

        assert fetcher.rate_backoffs == 3
        assert fetcher.current_rps < initial_rps

    async def test_a_success_after_a_block_resets_the_consecutive_counter(self) -> None:
        responses = iter([429, 200, 429, 429])

        def handler(request: httpx.Request) -> httpx.Response:
            if "/_next/data/" not in str(request.url):
                return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)
            status = next(responses)
            if status == 200:
                return httpx.Response(
                    200,
                    json={"pageProps": {"profile": {"id": 1, "slug": "Yale-University"}}},
                    request=request,
                )
            return httpx.Response(status, text="slow down", request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            # 429, then 200 (resets), then two more 429s — never hits 3
            # *consecutive* blocks, so no exception.
            for _ in range(4):
                await fetcher.fetch_tab("Yale-University", "money-matters")

        assert fetcher.rate_backoffs == 3


class TestFetchTabHappyPath:
    async def test_200_yields_an_ok_page_with_the_profile(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if "/_next/data/" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "pageProps": {
                            "profile": {"id": 1, "slug": "Yale-University", "chance": None}
                        }
                    },
                    request=request,
                )
            return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            page = await fetcher.fetch_tab("Yale-University", "overview")

        assert page.page_status == "ok"
        assert page.profile == {"id": 1, "slug": "Yale-University", "chance": None}
        assert page.build_id == BUILD_ID

    async def test_502_is_retried_then_succeeds(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_out_retry_backoff_sleep(monkeypatch)
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            if "/_next/data/" not in str(request.url):
                return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)
            attempts += 1
            if attempts < 2:
                return httpx.Response(502, text="bad gateway", request=request)
            return httpx.Response(
                200,
                json={"pageProps": {"profile": {"id": 1, "slug": "Yale-University"}}},
                request=request,
            )

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            page = await fetcher.fetch_tab("Yale-University", "overview")

        assert page.page_status == "ok"
        assert attempts == 2

    async def test_persistent_502_becomes_http_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_out_retry_backoff_sleep(monkeypatch)

        def handler(request: httpx.Request) -> httpx.Response:
            if "/_next/data/" not in str(request.url):
                return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)
            return httpx.Response(502, text="bad gateway", request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            page = await fetcher.fetch_tab("Yale-University", "overview")

        assert page.page_status == "http_error"
        assert page.http_status == 502

    async def test_malformed_json_becomes_parse_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if "/_next/data/" not in str(request.url):
                return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)
            return httpx.Response(200, text="not json at all", request=request)

        async with _client(handler) as client:
            fetcher = _fetcher(client)
            await fetcher.resolve_build_id("Yale-University")
            page = await fetcher.fetch_tab("Yale-University", "overview")

        assert page.page_status == "parse_error"


class TestFetchConfig:
    """school-data-v3 fix-review Finding 1: the documented `<domain>`
    placeholder must never pass as a usable User-Agent — it resolves to
    nothing and would silently defeat ADR 0038 R0's identification
    mitigation for every request a misconfigured deploy sends."""

    def test_rejects_a_user_agent_with_no_url(self) -> None:
        with pytest.raises(ValueError, match="contact URL"):
            FetchConfig(user_agent="CounselleBot/1.0")

    def test_rejects_the_documented_placeholder_default(self) -> None:
        """`FetchConfig()`'s own default is the literal, never-real
        `<domain>` placeholder — proof that an unconfigured deploy can
        never construct a working fetcher, even before any request is
        sent, and even if `Settings` itself booted with the placeholder
        (which it does in `development` — see `config/settings.py`'s
        `_validate_deploy_auth_posture`)."""
        with pytest.raises(ValueError, match="placeholder"):
            FetchConfig()

    def test_rejects_the_documented_placeholder_even_when_passed_explicitly(self) -> None:
        with pytest.raises(ValueError, match="placeholder"):
            FetchConfig(user_agent="CounselleBot/1.0 (+https://<domain>/bot)")

    def test_accepts_a_real_contact_url(self) -> None:
        config = FetchConfig(user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)")
        assert config.user_agent == "CounselleBot/1.0 (+https://counselle.ai/bot)"


class TestRobotsCompliance:
    """school-data-v3 fix-review Finding 2: `robots.txt` is respected
    *live*, not as a hardcoded transcription of a past read — a real fetch
    and parse happens once per pass, and every outbound URL is checked
    against it."""

    async def test_fetches_robots_txt_exactly_once_per_pass(self) -> None:
        robots_requests = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal robots_requests
            url = str(request.url)
            if url.endswith("/robots.txt"):
                robots_requests += 1
                return httpx.Response(200, text="User-agent: *\nAllow: /\n", request=request)
            if "/_next/data/" not in url:
                return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)
            return httpx.Response(200, json={"pageProps": {"profile": {}}}, request=request)

        config = FetchConfig(
            rps=1000.0, user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            await fetcher.resolve_build_id("Yale-University")
            await fetcher.fetch_tab("Yale-University", "overview")
            await fetcher.fetch_tab("Yale-University", "admission")

        assert robots_requests == 1

    async def test_missing_robots_txt_defaults_to_allow_all(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("/robots.txt"):
                return httpx.Response(404, text="not found", request=request)
            return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)

        config = FetchConfig(
            rps=1000.0, user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            build_id = await fetcher.resolve_build_id("Yale-University")

        assert build_id == BUILD_ID

    async def test_live_disallow_of_a_needed_path_aborts_the_fetch(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("/robots.txt"):
                return httpx.Response(
                    200, text="User-agent: *\nDisallow: /_next/data/\n", request=request
                )
            return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)

        config = FetchConfig(
            rps=1000.0, user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            await fetcher.resolve_build_id("Yale-University")
            with pytest.raises(RobotsDisallowedError):
                await fetcher.fetch_tab("Yale-University", "overview")

    async def test_live_disallow_covers_a_hubspot_shaped_path_too(self) -> None:
        """The module docstring's HubSpot claim used to hold only because
        this module's own URL constructors never build such a path — now
        it's genuinely defended: any live disallow, HubSpot-shaped or not,
        is enforced the same way."""

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("/robots.txt"):
                return httpx.Response(
                    200,
                    text="User-agent: *\nDisallow: /hs/\n",
                    request=request,
                )
            return httpx.Response(200, text="ok", request=request)

        config = FetchConfig(
            rps=1000.0, user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            with pytest.raises(RobotsDisallowedError):
                await fetcher._get(
                    "https://www.collegedata.com/hs/some-form", follow_redirects=False
                )

    async def test_redirect_target_is_robots_checked_too(self) -> None:
        """Finding 4 (school-data-v3 fix review): `resolve_build_id` is the
        only `follow_redirects=True` caller. Before this fix, httpx's own
        redirect-following fetched the target internally, past
        `_assert_robots_allows` -- so a robots disallow scoped only to the
        redirect target (not the URL `resolve_build_id` actually names)
        would never be caught. `_get` now follows redirects itself, one hop
        at a time, so every hop gets its own robots check."""

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("/robots.txt"):
                return httpx.Response(
                    200,
                    text="User-agent: *\nDisallow: /redirected-to/\n",
                    request=request,
                )
            if "/redirected-to/" in url:
                raise AssertionError("the disallowed redirect target must never be fetched")
            return httpx.Response(
                301,
                headers={"location": "https://www.collegedata.com/redirected-to/Yale"},
                request=request,
            )

        config = FetchConfig(
            rps=1000.0, user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            with pytest.raises(RobotsDisallowedError):
                await fetcher.resolve_build_id("Yale-University")

    async def test_redirect_target_is_fetched_when_robots_allows_it(self) -> None:
        """The happy path still works: an allowed redirect target is
        fetched (one extra hop, paced by the same token bucket) and its
        body is what `resolve_build_id` scrapes the buildId from."""

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("/robots.txt"):
                return httpx.Response(200, text="", request=request)
            if "/redirected-to/" in url:
                return httpx.Response(200, text=_html_with_build_id(BUILD_ID), request=request)
            return httpx.Response(
                301,
                headers={"location": "https://www.collegedata.com/redirected-to/Yale"},
                request=request,
            )

        config = FetchConfig(
            rps=1000.0, user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            build_id = await fetcher.resolve_build_id("Yale-University")
        assert build_id == BUILD_ID

    async def test_api_path_is_still_blocked_before_robots_txt_ever_loads(self) -> None:
        """`AllowedPathViolation`'s construction-time floor holds even
        though robots.txt hasn't been fetched yet — it never depends on the
        network."""

        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("the transport must never be reached for /api/*")

        config = FetchConfig(
            rps=1000.0, user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            with pytest.raises(AllowedPathViolation):
                await fetcher._get(
                    "https://www.collegedata.com/api/college-search", follow_redirects=False
                )


class TestResponseSizeCeiling:
    """school-data-v3 fix-review Finding 3: no fetch path buffers an
    unbounded external response, and gunzip is bounded against a
    decompression bomb."""

    async def test_oversized_response_is_rejected(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("/robots.txt"):
                return httpx.Response(200, text="", request=request)
            return httpx.Response(200, text="x" * 1000, request=request)

        config = FetchConfig(
            rps=1000.0,
            user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)",
            max_response_bytes=100,
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            with pytest.raises(ResponseTooLargeError):
                await fetcher._get_bytes("https://www.collegedata.com/sitemap_index.xml")

    async def test_response_within_the_ceiling_is_accepted(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith("/robots.txt"):
                return httpx.Response(200, text="", request=request)
            return httpx.Response(200, text="x" * 50, request=request)

        config = FetchConfig(
            rps=1000.0,
            user_agent="CounselleBot/1.0 (+https://counselle.ai/bot)",
            max_response_bytes=100,
        )
        async with _client(handler) as client:
            fetcher = CollegeDataFetcher(config, client)
            body = await fetcher._get_bytes("https://www.collegedata.com/sitemap_index.xml")
        assert len(body) == 50

    def test_maybe_gunzip_rejects_a_decompression_bomb(self) -> None:
        # A gzip payload whose decompressed size wildly exceeds its
        # compressed size — the "small compressed, huge decompressed"
        # shape a zip bomb relies on.
        bomb = gzip.compress(b"0" * 10_000_000, compresslevel=9)
        assert len(bomb) < 20_000  # confirms this really is a high-ratio payload

        with pytest.raises(ResponseTooLargeError):
            _maybe_gunzip(bomb, max_bytes=1_000_000)

    def test_maybe_gunzip_accepts_a_normal_payload_within_the_ceiling(self) -> None:
        raw = gzip.compress(_SITEMAP_INDEX_XML)
        assert _maybe_gunzip(raw, max_bytes=1_000_000) == _SITEMAP_INDEX_XML

    def test_maybe_gunzip_passes_through_non_gzip_bytes_unchanged(self) -> None:
        assert _maybe_gunzip(_SITEMAP_INDEX_XML, max_bytes=1_000_000) == _SITEMAP_INDEX_XML


class TestHardenedXmlParsing:
    """school-data-v3 fix-review Finding 3: sitemap XML is parsed with
    `defusedxml`, not stdlib `xml.etree.ElementTree` — entity-expansion
    ("billion laughs") payloads must be rejected, not expanded."""

    def test_rejects_a_billion_laughs_style_entity_expansion(self) -> None:
        bomb = (
            b'<?xml version="1.0"?>'
            b"<!DOCTYPE lolz [<!ENTITY lol \"lol\">"
            b"<!ENTITY lol2 \"&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;\">]>"
            b"<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"
            b"<url><loc>&lol2;</loc></url></urlset>"
        )
        with pytest.raises(Exception):  # noqa: B017 -- defusedxml's own entity-forbidden error
            parse_sitemap_locs(bomb)

    def test_still_parses_ordinary_sitemap_xml(self) -> None:
        locs = parse_sitemap_locs(_urlset("https://www.collegedata.com/a", "https://www.collegedata.com/b"))
        assert locs == ["https://www.collegedata.com/a", "https://www.collegedata.com/b"]
