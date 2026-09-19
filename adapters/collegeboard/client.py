"""HTTP fetch adapter for College Board's SAT Suite Question Bank (plan
plans/sat-practice/plan.md §3.1/§3.2).

**This is the only code in the project that talks to College Board.** Four
unauthenticated JSON endpoints over two hosts:

- **E1** `POST qbank-api.collegeboard.org/.../questionbank/digital/get-questions`
  `{asmtEventId, test, domain}` — question stubs for one (assessment, test)
  pair.
- **E2** `POST qbank-api.collegeboard.org/.../questionbank/digital/get-question`
  `{external_id}` — one qbank question's full detail.
- **E3** `GET saic.collegeboard.org/disclosed/{ibn}.json` — one legacy
  disclosed item.
- **E4** `GET qbank-api.collegeboard.org/.../questionbank/lookup` — the
  taxonomy + live-item + Bluebook-flag lookup document.

**robots.txt policy (plan §3.2, decided).** Both hosts answer `/robots.txt`
with 403 (measured 2026-09-19) — no robots.txt exists and the gateway
refuses the path. Rather than treat that as a blanket abort (which would
make this fetch impossible for a reason unrelated to the publisher's
wishes), this module fetches and parses `robots.txt` per host, live, before
that host's first content request, and applies: **200 → obey it**; **404 →
allowed**; **other 4xx → "unavailable", which RFC 9309 §2.3.1.3 defines as
allowed**; **5xx → abort**. The per-host outcome is exposed via
`CollegeBoardClient.robots_outcomes` for the caller to record into
`AUDIT.md`. This settles crawl etiquette only — whether the content may be
*used* is a separate, owner-level question (plan O5), not this module's
concern.

**No evasion of any kind; no browser impersonation.** `httpx` with a plain,
truthful, self-identifying User-Agent (`CollegeBoardConfig.user_agent`,
validated to carry a real contact URL — see `user_agent_has_contact_url`,
duplicated from `adapters/collegedata/fetch.py` for the same ADR 0017
layering reason its own copy is duplicated: this module cannot import
`config.settings`, so the caller builds `CollegeBoardConfig` from Settings
and this module validates independently of Settings' own boot check).

**Resumable and idempotent by design of the caller, not this module** — the
plan's `fetch` step writes every response verbatim to disk before parsing;
this module's job is only to fetch and hand back raw bytes, never to parse
question content itself. Every response is retried up to 4 times with
exponential backoff on 429 / 5xx / timeout / connect error before this
module gives up and raises; every JSON response is checked for a real
`application/json` content-type and capped at `CollegeBoardConfig.max_response_bytes`
before its bytes are returned (CLAUDE.md: "never trust external data").
"""

from __future__ import annotations

import asyncio
import re
import urllib.robotparser as robotparser
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from adapters._ratelimit import TokenBucket

__all__ = [
    "CollegeBoardClient",
    "CollegeBoardConfig",
    "CollegeBoardError",
    "RobotsAbortError",
    "RobotsDisallowedError",
    "RobotsPolicyOutcome",
    "ResponseTooLargeError",
    "TransportFailure",
    "UnexpectedContentTypeError",
    "UnsafeIdentifierError",
    "UpstreamHttpError",
    "build_client",
    "user_agent_has_contact_url",
]

# ---------------------------------------------------------------------------
# Hosts and endpoint URLs (plan §3.1) — fixed shape, never a Settings knob.
# ---------------------------------------------------------------------------

QBANK_HOST = "qbank-api.collegeboard.org"
SAIC_HOST = "saic.collegeboard.org"

_QBANK_QUESTIONBANK_ROOT = f"https://{QBANK_HOST}/msreportingquestionbank-prod/questionbank"
_GET_QUESTIONS_URL = f"{_QBANK_QUESTIONBANK_ROOT}/digital/get-questions"
_GET_QUESTION_URL = f"{_QBANK_QUESTIONBANK_ROOT}/digital/get-question"
_LOOKUP_URL = f"{_QBANK_QUESTIONBANK_ROOT}/lookup"
_SAIC_DISCLOSED_ROOT = f"https://{SAIC_HOST}/disclosed"

_UA_URL_RE = re.compile(r"https?://\S+")
# The documented, never-real placeholder (mirrors config/settings.py's
# `_FACTS_CRAWL_UA_PLACEHOLDER_MARKER` / `sat_fetch_user_agent` default).
_UA_PLACEHOLDER_MARKER = "<domain>"

# An `external_id` / `ibn` is interpolated straight into a URL path — this
# is a construction-time floor against a malformed or hostile id building
# an unintended request, never a real College Board value (both are
# alphanumeric-with-hyphens in every sample this project has seen).
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# 429/5xx are retried; timeouts and connection failures are retried via
# httpx.TransportError. A stub whose detail still fails after this many
# attempts is the caller's (app/sat CLI's) job to record and move on from
# (plan §3.2: "goes to failures.json and fails the run").
_RETRY_ATTEMPTS = 4


def user_agent_has_contact_url(user_agent: str) -> bool:
    """True if `user_agent` carries a real `http(s)://` contact URL and is
    not the documented `<domain>` placeholder. Duplicated from
    `adapters/collegedata/fetch.py` (same rule, same layering reason: this
    module cannot import `config.settings`, and `config/settings.py` cannot
    import `adapters/` — ADR 0017)."""
    return bool(_UA_URL_RE.search(user_agent)) and _UA_PLACEHOLDER_MARKER not in user_agent


class CollegeBoardConfig(BaseModel):
    """Every crawl-rate/identification tunable this module consumes (plan
    §3.2/§4.3). Constructed by the caller (`app/sat/bank.py`) from
    `Settings` — this module does not import `config.settings` directly."""

    model_config = ConfigDict(frozen=True, extra="forbid", validate_default=True)

    rps: float = Field(default=4.0, gt=0)
    request_timeout_s: float = Field(default=20.0, gt=0)
    # Safety ceiling on any single fetched response body — a floor against
    # a malformed/adversarial response, not a tuning knob for legitimate
    # traffic (mirrors facts_crawl_max_response_bytes's default).
    max_response_bytes: int = Field(default=20_000_000, gt=0)
    user_agent: str = Field(
        default="CounselleBot/1.0 (+https://<domain>/bot)", min_length=1
    )

    @field_validator("user_agent")
    @classmethod
    def _user_agent_carries_a_url(cls, value: str) -> str:
        if not user_agent_has_contact_url(value):
            raise ValueError(
                "sat_fetch_user_agent must contain a real contact URL (http:// or "
                "https://) — the documented '<domain>' placeholder is never valid"
            )
        return value


class CollegeBoardError(Exception):
    """Base for this module's own exceptions (never a bare `Exception`)."""


class RobotsAbortError(CollegeBoardError):
    """`robots.txt` for a host returned 5xx (plan §3.2 policy) — the caller
    should abort the fetch run rather than guess at permission."""


class RobotsDisallowedError(CollegeBoardError):
    """The live `robots.txt` (fetched fresh, plan §3.2) disallows a path
    this module needs."""


class ResponseTooLargeError(CollegeBoardError):
    """A fetched response body exceeded `CollegeBoardConfig.max_response_bytes`
    (CLAUDE.md: "never trust external data")."""


class UnexpectedContentTypeError(CollegeBoardError):
    """A response that should have been JSON was not (an HTML error page,
    a redirect target, etc.) — never handed to a JSON parser."""


class UnsafeIdentifierError(CollegeBoardError):
    """An `external_id`/`ibn` value would build an unexpected URL path."""


class TransportFailure(CollegeBoardError):
    """A connection-level failure (`httpx.TransportError`) survived
    `_RETRY_ATTEMPTS` retries."""


class UpstreamHttpError(CollegeBoardError):
    """A request's final response was neither 200 nor a status this module
    retries — the caller decides what to do with one stub/item failing."""

    def __init__(self, status_code: int, url: str) -> None:
        super().__init__(f"College Board returned {status_code} for {url}")
        self.status_code = status_code
        self.url = url


class RobotsPolicyOutcome(BaseModel):
    """One host's robots.txt outcome (plan §3.2) — recorded by the caller
    into `AUDIT.md`."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    host: str
    status_code: int | None
    decision: Literal["obeyed", "allowed_not_found", "allowed_unavailable"]


def build_client(config: CollegeBoardConfig) -> httpx.AsyncClient:
    """The production `httpx.AsyncClient` — a plain client with only the
    truthful UA set (no evasion). Tests construct their own client over
    `httpx.MockTransport` instead of calling this."""
    return httpx.AsyncClient(headers={"User-Agent": config.user_agent})


def _robots_url(host: str) -> str:
    return f"https://{host}/robots.txt"


def _assert_safe_id(value: str, *, kind: str) -> None:
    if not _SAFE_ID_RE.fullmatch(value):
        raise UnsafeIdentifierError(f"refusing to build a URL from an unsafe {kind}: {value!r}")


def _assert_content_type_json(url: str, response: httpx.Response) -> None:
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise UnexpectedContentTypeError(
            f"expected application/json from {url}, got {content_type or '(none)'}"
        )


class _RetryableStatus(Exception):
    """Signals a 429/5xx response to tenacity — carries the response along
    so a caller who exhausts retries still gets it back, never `None`."""

    def __init__(self, response: httpx.Response) -> None:
        super().__init__(f"retryable status {response.status_code}")
        self.response = response


def _is_retryable_status(status_code: int) -> bool:
    return status_code == 429 or status_code >= 500


def _is_retryable_error(exc: BaseException) -> bool:
    return isinstance(exc, _RetryableStatus | httpx.TransportError)


_JsonBody = dict[str, str | int | None]


@retry(
    retry=retry_if_exception(_is_retryable_error),
    stop=stop_after_attempt(_RETRY_ATTEMPTS),
    wait=wait_exponential(multiplier=0.5, max=8),
    reraise=True,
)
async def _dispatch(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    json_body: _JsonBody | None,
    timeout: float,
) -> httpx.Response:
    """The single chokepoint every outbound request passes through — the
    429/5xx retry lives here. Never retried at this layer: any other
    status (2xx/3xx/4xx besides 429) is the caller's to interpret."""
    response = await client.request(method, url, json=json_body, timeout=timeout)
    if _is_retryable_status(response.status_code):
        raise _RetryableStatus(response)
    return response


class CollegeBoardClient:
    """Stateful fetcher for one fetch run (module docstring): owns the
    shared token bucket and the per-host robots.txt cache. One instance per
    `python -m app.sat fetch` invocation (`app/sat/bank.py`, not part of
    this module, constructs one from a `Settings`-derived
    `CollegeBoardConfig` and an `httpx.AsyncClient`)."""

    def __init__(self, config: CollegeBoardConfig, client: httpx.AsyncClient) -> None:
        self._config = config
        self._client = client
        self._bucket = TokenBucket(config.rps)
        self._robots_lock = asyncio.Lock()
        self._robots_outcomes: dict[str, RobotsPolicyOutcome] = {}
        self._robots_parsers: dict[str, robotparser.RobotFileParser | None] = {}

    @property
    def robots_outcomes(self) -> tuple[RobotsPolicyOutcome, ...]:
        """Every host's robots.txt outcome checked so far this run — for
        `AUDIT.md` (plan §3.2)."""
        return tuple(self._robots_outcomes.values())

    async def fetch_lookup(self) -> bytes:
        """E4: taxonomy, live-item lists, Bluebook flags, state offerings."""
        return await self._get_json(_LOOKUP_URL)

    async def fetch_questions(
        self, asmt_event_id: int, test: int, domain: str | None = None
    ) -> bytes:
        """E1: question stubs for one (assessment, test) pair."""
        body: _JsonBody = {"asmtEventId": asmt_event_id, "test": test, "domain": domain}
        return await self._post_json(_GET_QUESTIONS_URL, body)

    async def fetch_question_detail(self, external_id: str) -> bytes:
        """E2: one qbank question's full stem/options/key/rationale."""
        _assert_safe_id(external_id, kind="external_id")
        body: _JsonBody = {"external_id": external_id}
        return await self._post_json(_GET_QUESTION_URL, body)

    async def fetch_disclosed_item(self, ibn: str) -> bytes:
        """E3: one legacy disclosed item (`saic.collegeboard.org`)."""
        _assert_safe_id(ibn, kind="ibn")
        return await self._get_json(f"{_SAIC_DISCLOSED_ROOT}/{ibn}.json")

    async def _get_json(self, url: str) -> bytes:
        response = await self._request("GET", url, json_body=None)
        return self._validated_body(url, response)

    async def _post_json(self, url: str, json_body: _JsonBody) -> bytes:
        response = await self._request("POST", url, json_body=json_body)
        return self._validated_body(url, response)

    def _validated_body(self, url: str, response: httpx.Response) -> bytes:
        _assert_content_type_json(url, response)
        body = response.content
        if len(body) > self._config.max_response_bytes:
            raise ResponseTooLargeError(
                f"response for {url} is {len(body)} bytes, exceeding max_response_bytes="
                f"{self._config.max_response_bytes}"
            )
        return body

    async def _request(
        self, method: str, url: str, *, json_body: _JsonBody | None
    ) -> httpx.Response:
        host = urlsplit(url).netloc
        await self._ensure_robots_loaded(host)
        self._assert_robots_allows(host, url)
        await self._bucket.acquire()
        try:
            response = await _dispatch(
                self._client, method, url,
                json_body=json_body, timeout=self._config.request_timeout_s,
            )
        except _RetryableStatus as exc:
            raise UpstreamHttpError(exc.response.status_code, url) from exc
        except httpx.TransportError as exc:
            raise TransportFailure(str(exc)) from exc
        if response.status_code != 200:
            raise UpstreamHttpError(response.status_code, url)
        return response

    async def _ensure_robots_loaded(self, host: str) -> None:
        if host in self._robots_outcomes:
            return
        async with self._robots_lock:
            if host in self._robots_outcomes:
                return
            await self._load_robots(host)

    async def _load_robots(self, host: str) -> None:
        await self._bucket.acquire()
        try:
            response = await _dispatch(
                self._client, "GET", _robots_url(host),
                json_body=None, timeout=self._config.request_timeout_s,
            )
        except _RetryableStatus as exc:
            response = exc.response
        except httpx.TransportError as exc:
            raise RobotsAbortError(f"robots.txt fetch for {host} failed: {exc}") from exc
        self._record_robots_outcome(host, response)

    def _record_robots_outcome(self, host: str, response: httpx.Response) -> None:
        status = response.status_code
        if status == 200:
            parser = robotparser.RobotFileParser()
            parser.parse(response.text.splitlines())
            self._robots_parsers[host] = parser
            decision: Literal["obeyed", "allowed_not_found", "allowed_unavailable"] = "obeyed"
        elif status == 404:
            self._robots_parsers[host] = None
            decision = "allowed_not_found"
        elif status < 500:
            # RFC 9309 §2.3.1.3: any other 4xx (measured: both hosts answer
            # 403) means "unavailable", which is allowed.
            self._robots_parsers[host] = None
            decision = "allowed_unavailable"
        else:
            raise RobotsAbortError(
                f"robots.txt fetch for {host} returned {status} -- aborting per policy"
            )
        self._robots_outcomes[host] = RobotsPolicyOutcome(
            host=host, status_code=status, decision=decision
        )

    def _assert_robots_allows(self, host: str, url: str) -> None:
        parser = self._robots_parsers.get(host)
        if parser is not None and not parser.can_fetch(self._config.user_agent, url):
            raise RobotsDisallowedError(f"robots.txt disallows fetching: {url}")
