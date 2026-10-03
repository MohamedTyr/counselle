# /// script
# requires-python = ">=3.12"
# dependencies = ["asyncpg>=0.31", "httpx>=0.28", "pillow>=11"]
# ///
"""Regenerate `frontend/src/features/scholarships/sponsor-colours.json`.

Each scholarship card is tinted with its sponsor logo's colour, derived the
same way as the Explore school cards (`build_school_colours.py`, whose colour
math this reuses): the browser cannot read a favicon's pixels, so it is done
once, offline.

A colour is keyed by what the card's logo shows first: an admin-set logo URL,
otherwise the hostname of the sponsor's page, then of the application page
(the order `SponsorLogo.tsx` tries them). A logo with no dominant colour is
left out, and its card falls back to neutral grey.

It also lists the hostnames the favicon service has no icon for. The service
answers those with a 404 that still carries a generic globe image, which a
browser loads as if it were the sponsor's logo; the card skips the service
for them and tries the site's own favicon, then the sponsor's icon mark.

Run by hand when scholarships are added or their logos change:

    set -a; . ./.env; set +a
    uv run scripts/build_scholarship_colours.py
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse

import asyncpg
import httpx
from build_school_colours import CONCURRENCY, FAVICON_URL, dominant_colour

OUTPUT_PATH = (
    Path(__file__).resolve().parents[1] / "frontend/src/features/scholarships/sponsor-colours.json"
)


async def fetch_logo(
    client: httpx.AsyncClient, gate: asyncio.Semaphore, url: str
) -> tuple[int | None, tuple[str, str] | None]:
    """The response status and the logo's colour, if it has one."""
    async with gate:
        try:
            response = await client.get(url)
        except (httpx.HTTPError, httpx.InvalidURL):
            return None, None
    if response.status_code != 200:
        return response.status_code, None
    try:
        colour: tuple[str, str] | None = dominant_colour(response.content)
    except OSError:
        return response.status_code, None
    return response.status_code, colour


def logo_url_for(key: str) -> str:
    if key.startswith(("http://", "https://")):
        return key
    return FAVICON_URL.format(host=key)


def logo_keys(row: asyncpg.Record) -> list[str]:
    """Every key the card may look up for this row."""
    logo = row["logo_url"].strip()
    if logo:
        return [logo]
    hosts: list[str | None] = []
    for url in (row["source_url"], row["apply_url"]):
        try:
            hosts.append(urlparse(url).hostname)
        except ValueError:
            continue
    return [host for host in hosts if host]


async def main() -> None:
    connection = await asyncpg.connect(os.environ["COUNSELLE_DB_APP_DSN"])
    try:
        rows = await connection.fetch(
            "SELECT logo_url, source_url, apply_url FROM counselle.scholarships"
            " WHERE status <> 'archived'"
        )
    finally:
        await connection.close()

    keys = sorted({key for row in rows for key in logo_keys(row)})
    gate = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        results = await asyncio.gather(
            *(fetch_logo(client, gate, logo_url_for(key)) for key in keys)
        )

    colours = {
        key: list(colour)
        for key, (_, colour) in zip(keys, results, strict=True)
        if colour is not None
    }
    no_favicon = [
        key
        for key, (status, _) in zip(keys, results, strict=True)
        if status == 404 and not key.startswith(("http://", "https://"))
    ]
    table = {"colours": colours, "noFavicon": no_favicon}
    OUTPUT_PATH.write_text(json.dumps(table, separators=(",", ":"), sort_keys=True) + "\n")
    print(
        f"{len(colours)} of {len(keys)} sponsor logos have a colour,"
        f" {len(no_favicon)} sites have no favicon -> {OUTPUT_PATH}"
    )


if __name__ == "__main__":
    asyncio.run(main())
