# /// script
# requires-python = ">=3.12"
# dependencies = ["asyncpg>=0.31", "httpx>=0.28", "pillow>=11"]
# ///
"""Regenerate `frontend/src/features/schools/explore/school-colours.json`.

The Explore cards are tinted with each school's own colour. Nothing in the
facts store records a school's colours, and the browser cannot read a
favicon's pixels (the favicon service sends no CORS header), so this script
derives one colour per school from its favicon, once, offline:

  1. Fetch the same favicon the card shows (Google's s2 service, 64px).
  2. Keep the opaque, clearly chromatic pixels. Greys, whites and blacks are
     the background and outline of most crests, not the school's colour.
  3. Take the most common hue among them, and its median lightness and chroma.
     That is the fill.
  4. Darken that colour until it clears 5.2:1 against white, a margin over
     4.5:1 because the card tint sits under it. That is the text shade the
     card prints the admit rate in.

A school whose favicon has no dominant colour (the generic globe, a
monochrome wordmark) is left out, and its card falls back to neutral grey.

Run by hand when the school list changes:

    set -a; . ./.env; set +a
    uv run scripts/build_school_colours.py
"""

from __future__ import annotations

import asyncio
import io
import json
import math
import os
from pathlib import Path
from urllib.parse import urlparse

import asyncpg
import httpx
from PIL import Image

OUTPUT_PATH = (
    Path(__file__).resolve().parents[1]
    / "frontend/src/features/schools/explore/school-colours.json"
)
FAVICON_URL = "https://www.google.com/s2/favicons?domain={host}&sz=64"
CONCURRENCY = 16

MIN_ALPHA = 200
MIN_CHROMA = 0.07
LIGHTNESS_RANGE = (0.25, 0.95)
MIN_CHROMATIC_SHARE = 0.06
MIN_CHROMATIC_PIXELS = 20
HUE_BIN_DEGREES = 10
HUE_WINDOW_DEGREES = 15
TEXT_CONTRAST = 5.2


# ---- sRGB <-> OKLab (Björn Ottosson's reference matrices) ----


def _to_linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _from_linear(channel: float) -> float:
    if channel <= 0.0031308:
        return 12.92 * channel
    return 1.055 * channel ** (1 / 2.4) - 0.055


def rgb_to_oklch(r: int, g: int, b: int) -> tuple[float, float, float]:
    lr, lg, lb = (_to_linear(c / 255) for c in (r, g, b))
    l_ = math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    m_ = math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    s_ = math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    lightness = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return lightness, math.hypot(a, b2), math.degrees(math.atan2(b2, a)) % 360


def oklch_to_linear(lightness: float, chroma: float, hue: float) -> tuple[float, float, float]:
    a = chroma * math.cos(math.radians(hue))
    b = chroma * math.sin(math.radians(hue))
    l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )


def to_hex(lightness: float, chroma: float, hue: float) -> str:
    """Reduce chroma until the colour fits sRGB, then encode it."""
    while chroma > 0:
        linear = oklch_to_linear(lightness, chroma, hue)
        if all(-1e-4 <= c <= 1 + 1e-4 for c in linear):
            break
        chroma -= 0.002
    linear = oklch_to_linear(lightness, max(chroma, 0), hue)
    return "#" + "".join(
        f"{round(min(max(_from_linear(min(max(c, 0), 1)), 0), 1) * 255):02x}" for c in linear
    )


def contrast_on_white(hex_colour: str) -> float:
    rgb = [_to_linear(int(hex_colour[i : i + 2], 16) / 255) for i in (1, 3, 5)]
    luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return 1.05 / (luminance + 0.05)


# ---- colour extraction ----


def _hue_distance(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def dominant_colour(image_bytes: bytes) -> tuple[str, str] | None:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    opaque = [p for p in image.getdata() if p[3] >= MIN_ALPHA]
    chromatic = []
    for r, g, b, _ in opaque:
        lightness, chroma, hue = rgb_to_oklch(r, g, b)
        if chroma >= MIN_CHROMA and LIGHTNESS_RANGE[0] <= lightness <= LIGHTNESS_RANGE[1]:
            chromatic.append((lightness, chroma, hue))
    if len(chromatic) < MIN_CHROMATIC_PIXELS or len(chromatic) < MIN_CHROMATIC_SHARE * len(opaque):
        return None

    bins = [0] * (360 // HUE_BIN_DEGREES)
    for _, _, hue in chromatic:
        bins[int(hue // HUE_BIN_DEGREES) % len(bins)] += 1
    peak = (bins.index(max(bins)) + 0.5) * HUE_BIN_DEGREES
    cluster = [p for p in chromatic if _hue_distance(p[2], peak) <= HUE_WINDOW_DEGREES]

    lightness = sorted(p[0] for p in cluster)[len(cluster) // 2]
    chroma = sorted(p[1] for p in cluster)[len(cluster) // 2]
    hue = (
        math.degrees(
            math.atan2(
                sum(math.sin(math.radians(p[2])) for p in cluster),
                sum(math.cos(math.radians(p[2])) for p in cluster),
            )
        )
        % 360
    )

    fill = to_hex(lightness, chroma, hue)
    text_lightness = lightness
    text = fill
    while contrast_on_white(text) < TEXT_CONTRAST and text_lightness > 0.2:
        text_lightness -= 0.01
        text = to_hex(text_lightness, chroma, hue)
    return fill, text


async def colour_for(
    client: httpx.AsyncClient, gate: asyncio.Semaphore, website_url: str
) -> tuple[str, str] | None:
    host = urlparse(website_url).hostname
    if not host:
        return None
    async with gate:
        try:
            response = await client.get(FAVICON_URL.format(host=host))
        except httpx.HTTPError:
            return None
    if response.status_code != 200:
        return None
    try:
        return dominant_colour(response.content)
    except OSError:
        return None


async def main() -> None:
    connection = await asyncpg.connect(os.environ["COUNSELLE_DB_RO_DSN"])
    try:
        rows = await connection.fetch(
            "SELECT school_id, official_website FROM cds_library.school_explore"
            " WHERE official_website IS NOT NULL ORDER BY school_id"
        )
    finally:
        await connection.close()

    gate = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        colours = await asyncio.gather(
            *(colour_for(client, gate, row["official_website"]) for row in rows)
        )

    table = {
        str(row["school_id"]): list(colour)
        for row, colour in zip(rows, colours, strict=True)
        if colour is not None
    }
    OUTPUT_PATH.write_text(json.dumps(table, separators=(",", ":")) + "\n")
    print(f"{len(table)} of {len(rows)} schools have a colour -> {OUTPUT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
