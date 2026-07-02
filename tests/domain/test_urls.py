"""Unit tests for domain/urls.py — registrable domain + favicon URL (pure)."""

from __future__ import annotations

import pytest

from domain.urls import FAVICON_PROXY_PATH, favicon_url, registrable_domain


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.duke.edu/admissions", "duke.edu"),
        ("www.aamu.edu/", "aamu.edu"),  # bare, scheme-less, trailing slash (the DB shape)
        ("https://www.uab.edu/", "uab.edu"),
        ("https://eecs.mit.edu/grad", "eecs.mit.edu"),  # subdomain kept
        ("http://example.com:8080/x", "example.com"),  # port dropped
        ("HTTPS://WWW.Stanford.EDU", "stanford.edu"),  # lowercased
        ("http://a.com@evil.com/x", "evil.com"),  # userinfo stripped
        ("https://mit.edu./x", "mit.edu"),  # trailing-dot host normalized
        ("www.duke.edu./", "duke.edu"),  # bare, trailing-dot
        ("", None),
        ("   ", None),
    ],
)
def test_registrable_domain(url: str, expected: str | None) -> None:
    assert registrable_domain(url) == expected


def test_favicon_url_builds_from_proxy_path_and_host() -> None:
    # Points at our own same-origin proxy (api/routes/favicon.py), not the CDN
    # directly — see domain/urls.py's module docstring for why.
    assert favicon_url("mit.edu") == f"{FAVICON_PROXY_PATH}?host=mit.edu&sz=64"
    assert favicon_url("mit.edu", size=32) == f"{FAVICON_PROXY_PATH}?host=mit.edu&sz=32"


def test_favicon_url_none_for_empty_host() -> None:
    assert favicon_url("") is None
    assert favicon_url("   ") is None


def test_favicon_url_encodes_host() -> None:
    # The host is URL-encoded into the query — a stray '&'/'?'/space can't
    # inject extra query params into the proxy URL.
    assert favicon_url("a b&c.edu") == f"{FAVICON_PROXY_PATH}?host=a%20b%26c.edu&sz=64"
