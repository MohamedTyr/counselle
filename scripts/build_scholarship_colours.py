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
from build_school_colours import CONCURRENCY, colour_for, dominant_colour

OUTPUT_PATH = (
    Path(__file__).resolve().parents[1] / "frontend/src/features/scholarships/sponsor-colours.json"
)


async def logo_colour(
    client: httpx.AsyncClient, gate: asyncio.Semaphore, logo_url: str
) -> tuple[str, str] | None:
    async with gate:
        try:
            response = await client.get(logo_url)
        except httpx.HTTPError:
            return None
    if response.status_code != 200:
        return None
    try:
        colour: tuple[str, str] | None = dominant_colour(response.content)
    except OSError:
        return None
    return colour


def logo_keys(row: asyncpg.Record) -> list[str]:
    """Every key the card may look up for this row."""
    logo = row["logo_url"].strip()
    if logo:
        return [logo]
    hosts = (urlparse(url).hostname for url in (row["source_url"], row["apply_url"]))
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
        colours = await asyncio.gather(
            *(
                logo_colour(client, gate, key)
                if key.startswith(("http://", "https://"))
                else colour_for(client, gate, f"https://{key}")
                for key in keys
            )
        )

    table = {
        key: list(colour) for key, colour in zip(keys, colours, strict=True) if colour is not None
    }
    OUTPUT_PATH.write_text(json.dumps(table, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"{len(table)} of {len(keys)} sponsor logos have a colour -> {OUTPUT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
