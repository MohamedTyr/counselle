"""Tests for adapters/collegeboard/client.py — NO network calls
(httpx.MockTransport throughout). These are plan §3.2's honesty-and-safety
tests: the robots.txt policy matrix (200/404/403/500), the 429/5xx retry,
the response-size cap, the content-type check, and the single shared token
bucket across both hosts.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

import httpx
import pytest

from adapters._ratelimit import TokenBucket
from adapters.collegeboard.client import (
    QBANK_HOST,
    SAIC_HOST,
    CollegeBoardClient,
    CollegeBoardConfig,
    ResponseTooLargeError,
    RobotsAbortError,
    RobotsDisallowedError,
    TransportFailure,
    UnexpectedContentTypeError,
    UnsafeIdentifierError,
    UpstreamHttpError,
    _dispatch,
    user_agent_has_contact_url,
)

_UA = "CounselleBot/1.0 (+https://counselle.ai/bot)"
_LOOKUP_PATH = "/msreportingquestionbank-prod/questionbank/lookup"
_GET_QUESTIONS_PATH = "/msreportingquestionbank-prod/questionbank/digital/get-questions"
_GET_QUESTION_PATH = "/msreportingquestionbank-prod/questionbank/digital/get-question"


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _config(**kwargs: object) -> CollegeBoardConfig:
    kwargs.setdefault("rps", 1000.0)  # fast tests; TestTokenBucket covers timing
    kwargs.setdefault("user_agent", _UA)
    return CollegeBoardConfig(**kwargs)  # type: ignore[arg-type]


def _robots_allow_all(request: httpx.Request) -> httpx.Response | None:
    if request.url.path == "/robots.txt":
        return httpx.Response(404, text="not found", request=request)
    return None


def _json_response(payload: object, request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=payload, request=request)


class TestUserAgentValidation:
    """Mirrors adapters/collegedata/fetch.py's FetchConfig gate — the
    documented `<domain>` placeholder must never pass as a usable UA."""

    def test_rejects_a_user_agent_with_no_url(self) -> None:
        assert user_agent_has_contact_url("CounselleBot/1.0") is False
        with pytest.raises(ValueError, match="contact URL"):
            _config(user_agent="CounselleBot/1.0")

    def test_rejects_the_documented_placeholder(self) -> None:
        assert user_agent_has_contact_url("CounselleBot/1.0 (+https://<domain>/bot)") is False
        with pytest.raises(ValueError, match="placeholder"):
            _config(user_agent="CounselleBot/1.0 (+https://<domain>/bot)")

    def test_accepts_a_real_contact_url(self) -> None:
        config = _config(user_agent=_UA)
        assert config.user_agent == _UA


class TestSharedTokenBucket:
    async def test_both_hosts_share_one_bucket(self) -> None:
        calls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            calls.append(request.url.host)
            if request.url.path == _LOOKUP_PATH:
                return _json_response({"lookupData": {}}, request)
            return _json_response({"item_id": "x"}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            await fetcher.fetch_lookup()
            await fetcher.fetch_disclosed_item("abc123")

        assert calls == [QBANK_HOST, SAIC_HOST]

    async def test_acquire_paces_requests_at_the_configured_rate(self) -> None:
        # Verifies the primitive this client is built on, same as
        # test_collegedata_fetch.py's own TokenBucket coverage.
        bucket = TokenBucket(rps=20.0)
        start = asyncio.get_event_loop().time()
        for _ in range(5):
            await bucket.acquire()
        elapsed = asyncio.get_event_loop().time() - start
        assert elapsed >= 0.19


class TestRobotsPolicyMatrix:
    """plan §3.2: 200 -> obey; 404 -> allowed; other 4xx -> "unavailable" =
    allowed (RFC 9309 §2.3.1.3); 5xx -> abort."""

    async def test_200_with_disallow_is_obeyed(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(
                    200, text="User-agent: *\nDisallow: /msreportingquestionbank-prod/\n",
                    request=request,
                )
            return _json_response({}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(RobotsDisallowedError):
                await fetcher.fetch_lookup()

        assert fetcher.robots_outcomes[0].decision == "obeyed"
        assert fetcher.robots_outcomes[0].status_code == 200

    async def test_200_without_disallow_allows_the_fetch(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nAllow: /\n", request=request)
            return _json_response({"lookupData": {}}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            body = await fetcher.fetch_lookup()

        assert body == b'{"lookupData":{}}' or b"lookupData" in body
        assert fetcher.robots_outcomes[0].decision == "obeyed"

    async def test_404_is_allowed(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            return _json_response({"lookupData": {}}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            await fetcher.fetch_lookup()

        assert fetcher.robots_outcomes[0].decision == "allowed_not_found"
        assert fetcher.robots_outcomes[0].status_code == 404

    async def test_403_is_treated_as_unavailable_and_allowed(self) -> None:
        """Measured live 2026-09-19: both College Board hosts answer
        /robots.txt with 403."""

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(403, json={"message": "Forbidden"}, request=request)
            return _json_response({"lookupData": {}}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            await fetcher.fetch_lookup()

        assert fetcher.robots_outcomes[0].decision == "allowed_unavailable"
        assert fetcher.robots_outcomes[0].status_code == 403

    async def test_500_aborts(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(asyncio, "sleep", _instant_sleep)

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(500, text="server error", request=request)
            raise AssertionError("must never fetch content after a robots.txt 5xx")

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(RobotsAbortError):
                await fetcher.fetch_lookup()

    async def test_robots_is_fetched_once_per_host(self) -> None:
        robots_requests: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                robots_requests.append(request.url.host)
                return httpx.Response(404, text="not found", request=request)
            return _json_response({"lookupData": {}}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            await fetcher.fetch_lookup()
            await fetcher.fetch_lookup()

        assert robots_requests == [QBANK_HOST]


async def _instant_sleep(_delay: float, result: object = None) -> object:
    return result


def _patch_out_retry_backoff_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)


class TestRetryAndBackoff:
    async def test_429_is_retried_then_succeeds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_out_retry_backoff_sleep(monkeypatch)
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            nonlocal attempts
            attempts += 1
            if attempts < 2:
                return httpx.Response(429, text="slow down", request=request)
            return _json_response({"lookupData": {}}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            await fetcher.fetch_lookup()

        assert attempts == 2

    async def test_5xx_is_retried_then_succeeds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_out_retry_backoff_sleep(monkeypatch)
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                return httpx.Response(503, text="bad gateway", request=request)
            return _json_response({"lookupData": {}}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            await fetcher.fetch_lookup()

        assert attempts == 3

    async def test_persistent_429_exhausts_retries_and_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_out_retry_backoff_sleep(monkeypatch)
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            nonlocal attempts
            attempts += 1
            return httpx.Response(429, text="slow down", request=request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(UpstreamHttpError) as excinfo:
                await fetcher.fetch_lookup()

        assert excinfo.value.status_code == 429
        assert attempts == 4

    async def test_connect_error_is_retried_and_raises_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_out_retry_backoff_sleep(monkeypatch)

        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            raise httpx.ConnectError("connection refused", request=request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(TransportFailure):
                await fetcher.fetch_lookup()

    async def test_404_is_not_retried_and_raises_immediately(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            nonlocal attempts
            attempts += 1
            return httpx.Response(404, text="not found", request=request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(UpstreamHttpError) as excinfo:
                await fetcher.fetch_lookup()

        assert excinfo.value.status_code == 404
        assert attempts == 1


class TestResponseValidation:
    async def test_oversized_response_is_rejected(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            return httpx.Response(
                200, content=b'{"pad":"' + b"x" * 200 + b'"}',
                headers={"content-type": "application/json"}, request=request,
            )

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(max_response_bytes=50), client)
            with pytest.raises(ResponseTooLargeError):
                await fetcher.fetch_lookup()

    async def test_response_within_the_ceiling_is_accepted(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            return _json_response({"ok": True}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(max_response_bytes=1000), client)
            body = await fetcher.fetch_lookup()

        assert b"ok" in body

    async def test_non_json_content_type_is_rejected(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            return httpx.Response(
                200, text="<html>not json</html>",
                headers={"content-type": "text/html"}, request=request,
            )

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(UnexpectedContentTypeError):
                await fetcher.fetch_lookup()


class TestUnsafeIdentifiers:
    async def test_rejects_a_path_traversal_external_id(self) -> None:
        async with _client(lambda r: _json_response({}, r)) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(UnsafeIdentifierError):
                await fetcher.fetch_question_detail("../../etc/passwd")

    async def test_rejects_an_unsafe_ibn(self) -> None:
        async with _client(lambda r: _json_response({}, r)) as client:
            fetcher = CollegeBoardClient(_config(), client)
            with pytest.raises(UnsafeIdentifierError):
                await fetcher.fetch_disclosed_item("abc/../def")

    async def test_accepts_a_normal_external_id(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            assert request.url.path == _GET_QUESTION_PATH
            return _json_response({"externalid": "52a8f1cb-bff4-4dcb-b455-fbc202e8513c"}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            body = await fetcher.fetch_question_detail("52a8f1cb-bff4-4dcb-b455-fbc202e8513c")

        assert b"externalid" in body


class TestEndpointRequestShapes:
    """plan §3.1: verifies each endpoint's method, path, and body."""

    async def test_fetch_questions_posts_the_expected_body(self) -> None:
        seen: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            assert request.method == "POST"
            assert request.url.path == _GET_QUESTIONS_PATH
            seen["body"] = httpx.Request("POST", request.url, content=request.content).content
            return _json_response([{"questionId": "abc"}], request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            body = await fetcher.fetch_questions(99, 1, domain=None)

        assert b"asmtEventId" in seen["body"]  # type: ignore[operator]
        assert b"questionId" in body

    async def test_fetch_disclosed_item_hits_saic(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            robots = _robots_allow_all(request)
            if robots is not None:
                return robots
            assert request.url.host == SAIC_HOST
            assert request.url.path == "/disclosed/abc123.json"
            return _json_response({"item_id": "abc123"}, request)

        async with _client(handler) as client:
            fetcher = CollegeBoardClient(_config(), client)
            body = await fetcher.fetch_disclosed_item("abc123")

        assert b"item_id" in body


class TestDispatchRetryPrimitive:
    """Directly covers `_dispatch`'s retry predicate, mirroring
    test_collegedata_fetch.py's `_send`-level coverage."""

    async def test_dispatch_retries_502_then_succeeds(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_out_retry_backoff_sleep(monkeypatch)
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts < 2:
                return httpx.Response(502, text="bad gateway", request=request)
            return httpx.Response(200, json={"ok": True}, request=request)

        async with _client(handler) as client:
            response = await _dispatch(
                client, "GET", "https://qbank-api.collegeboard.org/x",
                json_body=None, timeout=5.0,
            )

        assert response.status_code == 200
        assert attempts == 2
