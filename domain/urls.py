"""URL helpers shared across the domain core (registrable domain + favicon URL).

Both are pure string functions — no I/O, no config import (domain stays the
inward-most layer, ADR 0017). The favicon CDN base is a module constant, not a
Settings field, for the same reason: ``domain/`` must not depend on ``config/``.
Swapping CDNs is a one-line edit here. Nothing is hardcoded *per source* — the
host is always derived live from the data (a school's ``institution.website``
domain, or a search result's URL).
"""

from __future__ import annotations

from urllib.parse import quote, urlsplit

#: The favicon CDN. Google's s2 service returns a site's favicon for any host,
#: with a graceful generic-globe fallback; the client hides a missing image on
#: ``onError`` so a blocked/empty CDN degrades to a label-only chip, never a
#: broken render. One swappable constant — the *host* is always dynamic.
FAVICON_CDN_BASE = "https://www.google.com/s2/favicons"


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
    """The CDN favicon URL for a host, or ``None`` for an empty host."""
    host = host.strip()
    if not host:
        return None
    return f"{FAVICON_CDN_BASE}?domain={quote(host, safe='')}&sz={size}"
