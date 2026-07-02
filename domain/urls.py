"""URL helpers shared across the domain core (registrable domain + favicon URL).

Both are pure string functions — no I/O, no config import (domain stays the
inward-most layer, ADR 0017). The favicon CDN base is a module constant, not a
Settings field, for the same reason: ``domain/`` must not depend on ``config/``.
Swapping CDNs is a one-line edit here. Nothing is hardcoded *per source* — the
host is always derived live from the data (a school's ``institution.website``
domain, or a search result's URL).

``FAVICON_CDN_BASE``/``favicon_url`` here serve only the search-step source chips
(``app/steps.py``); the viz-card school logos use a separate, richer multi-CDN
chain in ``frontend/src/components/cards/schoolLogo.ts`` (the backend emits only
the ``domain`` string).

``favicon_url`` points at our OWN ``/v1/favicon`` proxy (``api/routes/favicon.py``),
not directly at the CDN: browser extensions/ad-blockers commonly intercept
third-party favicon-CDN requests (``google.com/s2/favicons`` is on several
blocklists) and silently swap in a blank image — a *valid* image, so the client's
``onError`` never fires and the chip renders empty with no signal anything went
wrong. Routing through our own origin removes that third-party request entirely;
the proxy is the one that talks to ``FAVICON_CDN_BASE``, server-side.
"""

from __future__ import annotations

from urllib.parse import quote, urlsplit

#: The upstream favicon CDN, fetched server-side only (``api/routes/favicon.py``).
#: Google's s2 service returns a site's favicon for any host, with a graceful
#: generic-globe fallback. One swappable constant — the *host* is always dynamic.
FAVICON_CDN_BASE = "https://www.google.com/s2/favicons"

#: Our own same-origin proxy path — see the module docstring for why the client
#: never talks to ``FAVICON_CDN_BASE`` directly.
FAVICON_PROXY_PATH = "/v1/favicon"


def registrable_domain(url: str) -> str | None:
    """The host of a URL with a leading ``www.`` stripped — ``None`` if absent.

    Robust to the two shapes the codebase feeds it: full URLs
    (``https://www.duke.edu/x`` → ``duke.edu``) and the bare, scheme-less,
    sometimes trailing-slashed strings stored for ``institution.website``
    (``www.aamu.edu/`` → ``aamu.edu``). Subdomains are kept (``eecs.mit.edu``
    stays ``eecs.mit.edu``) — chips name the real host, not just the eTLD+1
    (KISS: no ``tldextract`` dependency).
    """
    try:
        # A bare domain has no "//"; prefix one so urlsplit treats it as netloc.
        parsed = urlsplit(url if "//" in url else f"//{url}")
        netloc = (parsed.netloc or parsed.path).split("/", 1)[0].split(":", 1)[0].strip().lower()
        if "@" in netloc:  # drop RFC-3986 userinfo (a.com@evil.com → evil.com)
            netloc = netloc.rsplit("@", 1)[-1]
        if netloc.startswith("www."):
            netloc = netloc[4:]
        netloc = netloc.rstrip(".")  # trailing-dot hosts (mit.edu. → mit.edu)
        if " " in netloc:  # an internal space means it isn't a real host
            return None
        return netloc or None
    except Exception:
        return None


def favicon_url(host: str, *, size: int = 64) -> str | None:
    """Our own same-origin proxy URL for a host's favicon, or ``None`` if empty."""
    host = host.strip()
    if not host:
        return None
    return f"{FAVICON_PROXY_PATH}?host={quote(host, safe='')}&sz={size}"
