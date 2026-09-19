"""HTTP fetch adapter for collegedata.com (plan §2/§4.1, ADR 0038 risk R0).

**This is the only code in the project that talks to collegedata.com** — its
rate-limiting and identification posture is a hard requirement, not a
nicety. The owner has accepted R0 (Terms-of-Use/copyright risk) on condition
of every mitigation below being implemented, never relaxed:

- **`robots.txt` is respected — live, not a stale transcription.** Every
  pass fetches and parses the real `robots.txt` (`_ensure_robots_loaded`,
  stdlib `urllib.robotparser`) before its first content request, and every
  outbound URL is checked against it (`_assert_robots_allows`) before
  `_get` sends it — so a future disallow, or a narrowed `/_next/data/`
  allowance, is respected within the same pass it changes, not just as of
  whatever date someone last read the file by hand. This is also the real
  defense behind "HubSpot paths are disallowed": if the live document
  disallows them, `_assert_robots_allows` catches it directly, not by
  assuming this module's URL constructors merely never produce one (they
  don't — `_tab_url`/`_html_url`/the sitemap URLs — but that was never a
  substitute for checking the actual document). `_send`'s `/api/*` guard
  (`_assert_allowed_path`) is kept as a second, network-independent floor:
  it holds even before `robots.txt` has been fetched, or if fetching it
  ever fails BEFORE any request other than a robots.txt.
- **A truthful, self-identifying User-Agent carrying a contact URL.**
  `FetchConfig.user_agent` (Settings: `facts_crawl_user_agent`, default
  `CounselleBot/1.0 (+https://<domain>/bot)`) is validated to contain a URL
  *and* to not still be the documented `<domain>` placeholder — both here
  (`FetchConfig`, validated even against its own default, so this module
  can never construct itself with the placeholder) and at `Settings` boot
  (`config/settings.py`, outside `development`) — see
  `user_agent_has_contact_url`.
- **A shared 1 req/s token bucket** (`TokenBucket`, `FetchConfig.rps`) — one
  instance per crawl pass, shared across however many schools the caller
  runs concurrently (`facts_crawl_concurrency`, a pass-orchestration
  concern this module does not own; as of this module's Phase 1 build,
  `app/facts/crawl.py` runs schools strictly sequentially regardless of
  that setting's value).
- **No evasion of any kind.** No browser impersonation, no session
  rotation, no fingerprint spoofing, no proxies — `httpx` with a plain,
  truthful UA and nothing else. `security-reviewer` should be able to grep
  this file for exactly this claim and find it true.
- **External bytes never get an unbounded parser.** This is the one module
  ingesting raw third-party HTTP content (CLAUDE.md: "never trust external
  data"): every response is capped at `FetchConfig.max_response_bytes`
  (`_get`, after gunzip where applicable — `_maybe_gunzip` decompresses in
  bounded chunks so a gzip bomb is caught before it fully materializes),
  and sitemap/robots XML is parsed with `defusedxml` rather than stdlib
  `xml.etree.ElementTree`, which Python's own docs flag as vulnerable to
  entity-expansion and quadratic-blowup attacks on untrusted input.
- **Snapshots are for lineage only, never served** — enforced by `parse.py`/
  `adapters/facts_store.py`, not this module, but named here
  because it is part of the same R0 mitigation set.

`CollegeDataFetcher` is a **stateful, one-instance-per-pass** object: it
owns the token bucket, the cached `robots.txt` ruleset, the current Next.js
`buildId`, and the pass-scoped rotation/backoff counters, because the
plan's rotation and backoff rules ("concurrent 404s that resolve to the
same new id are one rotation"; "three consecutive [429/403] blocks abort
the pass") need state that spans every fetch call in the pass, not just
one. `app/facts/crawl.py` (not part of this module) constructs one
`CollegeDataFetcher` per pass from a `Settings`-derived `FetchConfig` and an
`httpx.AsyncClient`, and reacts to
`BuildIdRotationLimitExceeded`/`TooManyRateLimitBlocks`/`RobotsDisallowedError`/
`AllowedPathViolation` — the four causes that mean the crawler can no
longer trust its own request construction or the site's live permission
grant, not just this one school's data — by closing the pass as `aborted`.
A `ResponseTooLargeError` or `BuildIdNotFoundError` raised for one
slug/tab, by contrast, is this module doing exactly what it should: it is
`app/facts/crawl.py`'s job to catch those two, record the one school's
page failure, and move on (school-data-v3 fix review Finding 1).

No `Any` escapes this module's public surface.
"""

from __future__ import annotations

import asyncio
import gzip
import io
import re
import urllib.robotparser as robotparser
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

import httpx
from defusedxml.ElementTree import fromstring as _defused_fromstring
from pydantic import BaseModel, ConfigDict, Field, field_validator
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from adapters._ratelimit import TokenBucket
from domain.envelope import JsonValue
from domain.facts.models import TAB_NAMES, TabName

__all__ = [
    "AllowedPathViolation",
    "BuildIdNotFoundError",
    "BuildIdRotationLimitExceeded",
    "CollegeDataFetcher",
    "FetchConfig",
    "FetchedPage",
    "ResponseTooLargeError",
    "RobotsDisallowedError",
    "TooManyRateLimitBlocks",
    "TransportFailure",
    "build_client",
    "match_college_search_url",
    "parse_sitemap_locs",
    "user_agent_has_contact_url",
]

# ---------------------------------------------------------------------------
# Constants (plan §4.1/§4.3). Every crawl-rate/identification tunable is a
# FetchConfig field, sourced from Settings by the caller — see the module
# docstring. Everything below is fixed shape, not a tunable (it would never
# be "configured" independent of the logic it's part of — CLAUDE.md's
# one-source-of-truth test).
# ---------------------------------------------------------------------------

_BASE_URL = "https://www.collegedata.com"
_SITEMAP_INDEX_URL = f"{_BASE_URL}/sitemap_index.xml"
_ROBOTS_URL = f"{_BASE_URL}/robots.txt"
_COLLEGE_SEARCH_PREFIX = "/college-search/"
_GZIP_MAGIC = b"\x1f\x8b"
_SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
_BUILD_ID_RE = re.compile(r'"buildId"\s*:\s*"([^"]+)"')
_UA_URL_RE = re.compile(r"https?://\S+")
# The documented, never-real `facts_crawl_user_agent` placeholder (ADR 0038
# R0 Finding 1) — duplicated in `config/settings.py` for the same layering
# reason `user_agent_has_contact_url` itself is duplicated there.
_UA_PLACEHOLDER_MARKER = "<domain>"
# Chunk size for `_maybe_gunzip`'s bounded streaming decompression — small
# enough that a decompression bomb is caught within a few iterations,
# large enough not to matter for a legitimate few-MB sitemap.
_GUNZIP_CHUNK_SIZE = 1_048_576

# Slugs the sitemap lists with no tab siblings — never real schools, never
# crawled (plan §4.1/D1: `help` plus the five state-list pages).
NON_SCHOOL_SLUGS: frozenset[str] = frozenset(
    {"help", "michigan", "ohio", "pennsylvania", "texas", "virginia"}
)

# tab -> URL path suffix; `None` = the index route (plan §4.1: "overview is
# the index route" — no `/overview` suffix exists on the live site).
_TAB_SUFFIX: dict[TabName, str | None] = {
    "overview": None,
    "admission": "admission",
    "money-matters": "money-matters",
    "academics": "academics",
    "campus-life": "campus-life",
    "students": "students",
}
_TAB_BY_SUFFIX: dict[str | None, TabName] = {suffix: tab for tab, suffix in _TAB_SUFFIX.items()}

_COLLEGE_SEARCH_RE = re.compile(
    r"^https://(?:www|stg)\.collegedata\.com/college-search/([^/]+)(?:/([a-z-]+))?/?$"
)

# 502/503 are retried (plan §4.1: "the first request to an uncached page is
# often 502"); connection resets are retried via httpx.TransportError.
# Never 404 (handled as rotation-vs-not-found, not a transport failure) and
# never 429/403 (handled as a rate block, not a transport retry).
_RETRYABLE_STATUSES = frozenset({502, 503})
_RETRY_ATTEMPTS = 4

# "Three consecutive [429/403] blocks abort the pass" (plan §4.1) — fixed
# shape of the algorithm, not a tunable (CLAUDE.md's "would someone change
# this without changing the logic?" test says no).
_CONSECUTIVE_BLOCK_LIMIT = 3

# `_get`'s manual redirect loop (Finding 4, school-data-v3 fix review) —
# a hop ceiling against a redirect cycle, never a real collegedata.com
# response (`resolve_build_id`'s one `follow_redirects=True` call expects
# at most one hop in practice).
_MAX_REDIRECT_HOPS = 5


def user_agent_has_contact_url(user_agent: str) -> bool:
    """True if `user_agent` carries a real `http(s)://` contact URL (R0's
    "truthful, self-identifying UA" mitigation) — false for the documented
    `<domain>` placeholder, which resolves to nothing and must never pass
    validation (school-data-v3 fix-review Finding 1). Shared by
    `FetchConfig`'s own validation and by `config.settings.Settings`'s boot
    validator, so the rule is defined once even though it is enforced in
    two places for two different reasons (this module must be correct
    standalone; Settings must fail fast at boot)."""
    return bool(_UA_URL_RE.search(user_agent)) and _UA_PLACEHOLDER_MARKER not in user_agent


class FetchConfig(BaseModel):
    """Every crawl-rate/identification tunable this module consumes (plan
    §4.3). Constructed by the caller (`app/facts/crawl.py`) from
    `Settings` — this module does not import `config.settings` directly
    (matching every other `adapters/` module today)."""

    model_config = ConfigDict(frozen=True, extra="forbid", validate_default=True)

    rps: float = Field(default=1.0, gt=0)
    request_timeout_s: float = Field(default=20.0, gt=0)
    # `validate_default=True` above means this placeholder is rejected even
    # when nobody overrides it — `FetchConfig()` alone now fails fast
    # (Finding 1). The literal stays the documented placeholder, not a real
    # domain: the operator supplies the real one; this only forces them to.
    user_agent: str = Field(
        default="CounselleBot/1.0 (+https://<domain>/bot)", min_length=1
    )
    max_build_rotations: int = Field(default=3, gt=0)
    # Safety ceiling on any single fetched response body (Settings:
    # facts_crawl_max_response_bytes) — see the module docstring's "External
    # bytes never get an unbounded parser" mitigation.
    max_response_bytes: int = Field(default=20_000_000, gt=0)

    @field_validator("user_agent")
    @classmethod
    def _user_agent_carries_a_url(cls, value: str) -> str:
        if not user_agent_has_contact_url(value):
            raise ValueError(
                "facts_crawl_user_agent must contain a real contact URL (http:// or "
                "https://) — the documented '<domain>' placeholder is never valid"
            )
        return value


class FetchError(Exception):
    """Base for this module's own exceptions (never a bare `Exception`)."""


class AllowedPathViolation(FetchError):
    """A request would have touched `/api/*`. Should be unreachable in
    practice — every URL this module sends is built by its own
    constructors — this is a network-independent, construction-time
    chokepoint floor, kept alongside the live `robots.txt` check
    (`RobotsDisallowedError`) rather than instead of it: this one holds
    even before `robots.txt` has been fetched for the pass."""


class RobotsDisallowedError(FetchError):
    """The live `robots.txt`, fetched fresh at the start of this pass,
    disallows a path this crawler needs (ADR 0038 R0: "robots.txt is
    respected exactly as published"). Unlike `AllowedPathViolation` (a
    fixed, construction-time `/api/*` guard), this reflects the actual,
    current document — a new disallow, or a narrowed `/_next/data/`
    allowance, aborts the pass the moment it's discovered rather than
    going unnoticed."""


class ResponseTooLargeError(FetchError):
    """A fetched (and, if applicable, decompressed) response body exceeded
    `FetchConfig.max_response_bytes` (CLAUDE.md: "never trust external
    data" — this is the one module parsing raw third-party HTTP content).
    Real traffic never approaches this ceiling (plan §4.1: ~100 MB
    decompressed across the *entire* ~15,522-request pass); this exists as
    a floor against a malformed or adversarial response, not a tuning knob
    for legitimate traffic."""


class BuildIdNotFoundError(FetchError):
    """The HTML college-search page had no `"buildId"` in `__NEXT_DATA__`."""


class BuildIdRotationLimitExceeded(FetchError):
    """More distinct buildId rotations happened in this pass than
    `facts_crawl_max_build_rotations` allows (plan §4.1) — the caller
    should close the pass as `aborted`."""

    def __init__(self, rotations: int) -> None:
        super().__init__(f"{rotations} buildId rotations exceeds the configured limit")
        self.rotations = rotations


class TooManyRateLimitBlocks(FetchError):
    """Three consecutive 429/403 responses (plan §4.1) — the caller should
    close the pass as `aborted` with `error_code='blocked'`."""

    def __init__(self, consecutive_blocks: int) -> None:
        super().__init__(f"{consecutive_blocks} consecutive 429/403 responses")
        self.consecutive_blocks = consecutive_blocks


class TransportFailure(FetchError):
    """A connection-level failure (`httpx.TransportError`) survived
    `_RETRY_ATTEMPTS` retries. `fetch_tab` converts this into a
    `FetchedPage(page_status="http_error", http_status=None)`; the sitemap
    and buildId calls (pass-fatal either way) let it propagate."""


class FetchedPage(BaseModel):
    """One fetch outcome — the `fetch.py`/`parse.py` boundary type.

    `profile` is the raw, untouched `pageProps.profile` dict, present only
    when `page_status == "ok"`; `parse.py.parse_page` turns it into a typed
    `ParsedPage`. `never_fetched` (from `domain.facts.models.PageStatus`) is
    a store-side default this module never produces itself.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    tab: TabName
    url: str
    page_status: Literal["ok", "http_error", "not_found", "parse_error"]
    http_status: int | None = None
    build_id: str | None = None
    profile: dict[str, JsonValue] | None = None
    fetched_at: datetime


def build_client(config: FetchConfig) -> httpx.AsyncClient:
    """The production `httpx.AsyncClient` for `CollegeDataFetcher` — a
    plain client with only the truthful UA set (R0: no evasion). Tests
    construct their own client over `httpx.MockTransport` instead of
    calling this."""
    return httpx.AsyncClient(headers={"User-Agent": config.user_agent})


def _assert_allowed_path(url: str) -> None:
    path = urlsplit(url).path
    if path.startswith("/api/"):
        raise AllowedPathViolation(f"refusing to fetch a disallowed /api/* path: {url}")


class _RetryableStatus(Exception):
    """Signals a 502/503 response to tenacity — carries the response along
    so a caller who exhausts retries still gets it back, never `None`."""

    def __init__(self, response: httpx.Response) -> None:
        super().__init__(f"retryable status {response.status_code}")
        self.response = response


def _is_retryable_error(exc: BaseException) -> bool:
    return isinstance(exc, _RetryableStatus | httpx.TransportError)


@retry(
    retry=retry_if_exception(_is_retryable_error),
    stop=stop_after_attempt(_RETRY_ATTEMPTS),
    wait=wait_exponential(multiplier=0.5, max=8),
    reraise=True,
)
async def _send(
    client: httpx.AsyncClient, url: str, *, timeout: float, follow_redirects: bool
) -> httpx.Response:
    """The single chokepoint every outbound request passes through
    (module docstring: the `/api/*` guard, the timeout, and the 502/503
    retry all live here). 404/429/403 are not retryable at this layer —
    the caller (`CollegeDataFetcher`) interprets them (plan §4.1: "404 is
    handled by the fetcher, never retried as transport")."""
    _assert_allowed_path(url)
    response = await client.get(url, timeout=timeout, follow_redirects=follow_redirects)
    if response.status_code in _RETRYABLE_STATUSES:
        raise _RetryableStatus(response)
    return response


def _tab_url(slug: str, tab: TabName, build_id: str) -> str:
    suffix = _TAB_SUFFIX[tab]
    tail = f"/{suffix}" if suffix else ""
    path = f"{_COLLEGE_SEARCH_PREFIX}{slug.lower()}{tail}.json"
    return f"{_BASE_URL}/_next/data/{build_id}{path}?slug={slug}"


def _html_url(slug: str) -> str:
    return f"{_BASE_URL}{_COLLEGE_SEARCH_PREFIX}{slug}"


def match_college_search_url(url: str) -> tuple[str, TabName] | None:
    """`(slug, tab)` if `url` is a `/college-search/<Slug>[/<tab>]` sitemap
    entry (on either `www.` or `stg.` — the loader never fetches from
    `stg.`, it only needs to recognize the slug/tab there), else `None`.
    """
    match = _COLLEGE_SEARCH_RE.match(url)
    if match is None:
        return None
    slug, suffix = match.group(1), match.group(2)
    tab = _TAB_BY_SUFFIX.get(suffix)
    if tab is None:
        return None
    return slug, tab


def _maybe_gunzip(raw: bytes, *, max_bytes: int) -> bytes:
    """Decompress if `raw` is actually gzip; pass through otherwise.

    Measured live 2026-09-07: `a-sitemap.xml.gz`/`b-sitemap.xml.gz` are
    served as plain `text/xml`, not gzip, despite the `.gz` extension — a
    defensive sniff (rather than assuming either shape) survives either
    behavior.

    Decompresses in bounded chunks (via `gzip.GzipFile`, which inflates
    lazily as `.read()` is called) rather than calling `gzip.decompress`
    on the whole buffer at once, so a decompression bomb — a small
    compressed payload with a huge expansion ratio — is caught by
    `ResponseTooLargeError` partway through, never fully materialized in
    memory (CLAUDE.md: "never trust external data").
    """
    if raw[:2] != _GZIP_MAGIC:
        return raw
    out = bytearray()
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
        while True:
            chunk = gz.read(_GUNZIP_CHUNK_SIZE)
            if not chunk:
                break
            out.extend(chunk)
            if len(out) > max_bytes:
                raise ResponseTooLargeError(
                    f"decompressed sitemap exceeds facts_crawl_max_response_bytes="
                    f"{max_bytes}"
                )
    return bytes(out)


def parse_sitemap_locs(xml_bytes: bytes) -> list[str]:
    """Every `<loc>` text in a sitemap or sitemap-index document.

    Parsed with `defusedxml` (not stdlib `xml.etree.ElementTree`, which
    Python's own docs flag as vulnerable to entity-expansion ("billion
    laughs") and quadratic-blowup attacks on untrusted XML) — this module
    is the one place in the project parsing raw third-party XML.
    """
    root = _defused_fromstring(xml_bytes)
    return [loc.text.strip() for loc in root.findall(".//sm:loc", _SITEMAP_NS) if loc.text]


class CollegeDataFetcher:
    """Stateful fetcher for one crawl pass (module docstring)."""

    def __init__(self, config: FetchConfig, client: httpx.AsyncClient) -> None:
        self._config = config
        self._client = client
        self._bucket = TokenBucket(config.rps)
        self._build_id: str | None = None
        self._rotation_lock = asyncio.Lock()
        self._build_id_rotations = 0
        self._rate_backoffs = 0
        self._consecutive_blocks = 0
        # Live `robots.txt` ruleset for this pass — `None` until
        # `_ensure_robots_loaded` fetches it (lazily, on the first non-
        # robots.txt request), then cached for the rest of the pass.
        self._robots: robotparser.RobotFileParser | None = None

    @property
    def build_id(self) -> str | None:
        return self._build_id

    @property
    def build_id_rotations(self) -> int:
        return self._build_id_rotations

    @property
    def rate_backoffs(self) -> int:
        return self._rate_backoffs

    @property
    def current_rps(self) -> float:
        return self._bucket.rps

    async def discover_slugs(self) -> tuple[str, ...]:
        """Sitemap index -> every child sitemap -> unique school slugs with
        all six tab URLs present, de-duplicated, in first-seen order (plan
        §4.1: 2,587 slugs / 15,522 URLs on the committed fixture; excludes
        `NON_SCHOOL_SLUGS`, which never have tab siblings anyway so the
        "all six tabs present" filter already drops them structurally)."""
        max_bytes = self._config.max_response_bytes
        index_body = await self._get_bytes(_SITEMAP_INDEX_URL)
        child_urls = parse_sitemap_locs(_maybe_gunzip(index_body, max_bytes=max_bytes))
        slug_tabs: dict[str, set[TabName]] = {}
        slug_order: list[str] = []
        for child_url in child_urls:
            body = _maybe_gunzip(await self._get_bytes(child_url), max_bytes=max_bytes)
            for loc in parse_sitemap_locs(body):
                matched = match_college_search_url(loc)
                if matched is None:
                    continue
                slug, tab = matched
                if slug not in slug_tabs:
                    slug_tabs[slug] = set()
                    slug_order.append(slug)
                slug_tabs[slug].add(tab)
        return tuple(slug for slug in slug_order if len(slug_tabs[slug]) == len(TAB_NAMES))

    async def resolve_build_id(self, slug: str) -> str:
        """Fetch one HTML college-search page (redirects followed — the
        only place this module follows redirects, plan §4.1) and scrape
        the Next.js `buildId`. Any real slug works; the id is site-wide."""
        response = await self._get(_html_url(slug), follow_redirects=True)
        response.raise_for_status()
        match = _BUILD_ID_RE.search(response.text)
        if match is None:
            raise BuildIdNotFoundError(f"no buildId found in HTML for slug={slug!r}")
        self._build_id = match.group(1)
        return self._build_id

    async def fetch_tab(self, slug: str, tab: TabName) -> FetchedPage:
        """Fetch one (slug, tab) JSON page under the current buildId.

        Returns a `FetchedPage` for every ordinary per-page outcome
        (`ok`/`http_error`/`not_found`/`parse_error` — `crawl.py` uses
        these to update `school_pages`). Raises only for pass-level abort
        conditions the module docstring names.
        """
        if self._build_id is None:
            raise BuildIdNotFoundError("fetch_tab called before resolve_build_id")
        return await self._fetch_tab_under(slug, tab, self._build_id)

    async def _fetch_tab_under(self, slug: str, tab: TabName, build_id: str) -> FetchedPage:
        url = _tab_url(slug, tab, build_id)
        try:
            response = await self._get(url, follow_redirects=False)
        except TransportFailure:
            return FetchedPage(
                tab=tab,
                url=url,
                page_status="http_error",
                http_status=None,
                build_id=build_id,
                fetched_at=datetime.now(UTC),
            )
        if response.status_code == 404:
            return await self._handle_not_found(slug, tab, build_id)
        if response.status_code != 200:
            return FetchedPage(
                tab=tab,
                url=url,
                page_status="http_error",
                http_status=response.status_code,
                build_id=build_id,
                fetched_at=datetime.now(UTC),
            )
        try:
            payload = response.json()
            profile = payload["pageProps"]["profile"]
            if not isinstance(profile, dict):
                raise TypeError("profile is not an object")
        except Exception:
            return FetchedPage(
                tab=tab,
                url=url,
                page_status="parse_error",
                http_status=200,
                build_id=build_id,
                fetched_at=datetime.now(UTC),
            )
        return FetchedPage(
            tab=tab,
            url=url,
            page_status="ok",
            http_status=200,
            build_id=build_id,
            profile=profile,
            fetched_at=datetime.now(UTC),
        )

    async def _handle_not_found(
        self, slug: str, tab: TabName, attempted_build_id: str
    ) -> FetchedPage:
        async with self._rotation_lock:
            if self._build_id != attempted_build_id:
                # Someone else already rotated us past this build id while
                # we were waiting on the lock — retry under the current one
                # without counting a second rotation (plan §4.1: "concurrent
                # 404s that resolve to the same new id are one rotation").
                pass
            else:
                new_build_id = await self.resolve_build_id(slug)
                if new_build_id == attempted_build_id:
                    # Confirmed current buildId, still 404 -> genuinely no
                    # such tab for this school (plan §4.1), not a rotation.
                    return FetchedPage(
                        tab=tab,
                        url=_tab_url(slug, tab, attempted_build_id),
                        page_status="not_found",
                        http_status=404,
                        build_id=attempted_build_id,
                        fetched_at=datetime.now(UTC),
                    )
                self._build_id_rotations += 1
                if self._build_id_rotations > self._config.max_build_rotations:
                    raise BuildIdRotationLimitExceeded(self._build_id_rotations)
        # Retry once under the (just-confirmed-current) build id, outside
        # the lock — bounded by max_build_rotations via the recursive
        # 404 -> _handle_not_found path above, never unbounded.
        assert self._build_id is not None
        return await self._fetch_tab_under(slug, tab, self._build_id)

    async def _ensure_robots_loaded(self) -> None:
        """Fetch and parse the live `robots.txt` once per pass (ADR 0038
        R0: "robots.txt is respected exactly as published" — a live check,
        not a hardcoded transcription of a past read). A missing
        `robots.txt` (404) means nothing is disallowed (standard robots
        semantics); any other failure to fetch or parse it propagates and
        aborts the pass — this crawl never guesses "allow" when it can't
        actually confirm the live document says so."""
        if self._robots is not None:
            return
        response = await self._get(_ROBOTS_URL, follow_redirects=False)
        parser = robotparser.RobotFileParser()
        if response.status_code == 404:
            parser.parse([])
        else:
            response.raise_for_status()
            parser.parse(response.text.splitlines())
        self._robots = parser

    def _assert_robots_allows(self, url: str) -> None:
        assert self._robots is not None  # _get always loads it first
        if not self._robots.can_fetch(self._config.user_agent, url):
            raise RobotsDisallowedError(f"robots.txt disallows fetching: {url}")

    async def _get(
        self, url: str, *, follow_redirects: bool, _redirect_hops: int = 0
    ) -> httpx.Response:
        # Network-independent floor first (module docstring): must hold
        # even before robots.txt has ever been fetched for this pass, so it
        # runs ahead of `_ensure_robots_loaded` rather than after it.
        _assert_allowed_path(url)
        if url != _ROBOTS_URL:
            await self._ensure_robots_loaded()
            self._assert_robots_allows(url)
        await self._bucket.acquire()
        try:
            # Always sent un-followed (Finding 4, school-data-v3 fix
            # review): httpx's own `follow_redirects=True` would fetch a
            # redirect target internally, past `_assert_robots_allows`
            # above and past the token bucket, without either check ever
            # running against that target URL. `resolve_build_id` is the
            # only caller that wants redirects followed at all; the loop
            # below re-enters `_get` for the target instead, so every hop
            # gets its own robots check, its own rate-limit wait, and its
            # own response-size ceiling -- "every outbound URL is checked"
            # (module docstring) holds for real, not just for the first hop.
            response = await _send(
                self._client, url, timeout=self._config.request_timeout_s,
                follow_redirects=False,
            )
        except _RetryableStatus as exc:
            response = exc.response
        except httpx.TransportError as exc:
            raise TransportFailure(str(exc)) from exc
        if follow_redirects and response.is_redirect:
            location = response.headers.get("location")
            if location is not None:
                if _redirect_hops >= _MAX_REDIRECT_HOPS:
                    raise TransportFailure(
                        f"exceeded {_MAX_REDIRECT_HOPS} redirects resolving {url}"
                    )
                next_url = str(httpx.URL(url).join(location))
                return await self._get(
                    next_url, follow_redirects=follow_redirects, _redirect_hops=_redirect_hops + 1
                )
        if response.status_code in (429, 403):
            self._rate_backoffs += 1
            self._consecutive_blocks += 1
            self._bucket.halve()
            if self._consecutive_blocks >= _CONSECUTIVE_BLOCK_LIMIT:
                raise TooManyRateLimitBlocks(self._consecutive_blocks)
        else:
            self._consecutive_blocks = 0
        if len(response.content) > self._config.max_response_bytes:
            raise ResponseTooLargeError(
                f"response for {url} is {len(response.content)} bytes, exceeding "
                f"facts_crawl_max_response_bytes={self._config.max_response_bytes}"
            )
        return response

    async def _get_bytes(self, url: str) -> bytes:
        response = await self._get(url, follow_redirects=False)
        response.raise_for_status()
        return response.content
