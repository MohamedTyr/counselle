"""Fetch and split the supplemental-essay compilation page.

The source (``Settings.supplements_source_url``) is one public WordPress page
with a tab per application cycle; inside a tab, each school is a collapsible
"spoiler" block whose title is the school's name and whose body is the
prompts as prose. This module returns those blocks as plain text and knows
nothing about what a prompt is — reading prompts out of the text is
``app/supplements``' job.

One request a day, with the same posture as the CollegeData fetcher:
robots.txt is checked live before the request, and the User-Agent is the
truthful, contact-carrying ``facts_crawl_user_agent``.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser

import httpx

_TIMEOUT_S = 30.0
_PANE = re.compile(r'class="su-tabs-pane[^"]*"[^>]*data-title="([^"]*)"')
_SPOILER_TITLE = re.compile(
    r'<div class="su-spoiler-title"[^>]*>\s*<span class="su-spoiler-icon"></span>(.*?)</div>',
    re.S,
)
_BREAKS = re.compile(r"<\s*(br|/p|/li|/h\d|/div)\s*/?>", re.I)
_TAGS = re.compile(r"<[^>]+>")
_BLANK_LINES = re.compile(r"\n\s*\n+")


@dataclass(frozen=True)
class SourceBlock:
    """One school's block from the page, as plain text."""

    heading: str
    text: str


class SourceUnavailable(RuntimeError):
    """The page could not be read, or robots.txt now forbids reading it."""


async def fetch_source_html(url: str, *, user_agent: str) -> str:
    headers = {"User-Agent": user_agent}
    async with httpx.AsyncClient(
        timeout=_TIMEOUT_S, headers=headers, follow_redirects=True
    ) as client:
        robots = await client.get(urljoin(url, "/robots.txt"))
        # As urllib.robotparser.RobotFileParser.read(): a missing robots.txt
        # (4xx) allows everything, except 401/403, which disallow; a server
        # error means we cannot know, so this pass does not read the page.
        if robots.status_code >= 500:
            raise SourceUnavailable(f"robots.txt returned HTTP {robots.status_code}")
        parser = RobotFileParser()
        if robots.status_code in (401, 403):
            parser.disallow_all = True
        else:
            parser.parse(robots.text.splitlines() if robots.status_code == 200 else [])
        if not parser.can_fetch(user_agent, url):
            raise SourceUnavailable(f"robots.txt disallows {url}")
        response = await client.get(url)
        if response.status_code != 200:
            raise SourceUnavailable(f"{url} returned HTTP {response.status_code}")
        return response.text


def parse_cycle_blocks(page_html: str, cycle: str) -> list[SourceBlock]:
    """Every school block in the tab titled for *cycle*, in page order.

    Raises :class:`SourceUnavailable` when the page has no such tab, so a
    layout change or a missing cycle never reads as "every school dropped
    its supplements".
    """
    pane = _cycle_pane(page_html, cycle)
    titles = list(_SPOILER_TITLE.finditer(pane))
    blocks: list[SourceBlock] = []
    for index, match in enumerate(titles):
        end = titles[index + 1].start() if index + 1 < len(titles) else len(pane)
        heading = _to_text(match.group(1))
        body = _to_text(pane[match.end() : end])
        if heading:
            blocks.append(SourceBlock(heading=heading, text=body))
    if not blocks:
        raise SourceUnavailable(f"the {cycle} tab has no school blocks")
    return blocks


def _cycle_pane(page_html: str, cycle: str) -> str:
    panes = list(_PANE.finditer(page_html))
    for index, match in enumerate(panes):
        if cycle in html.unescape(match.group(1)):
            end = (
                page_html.rfind("<", 0, panes[index + 1].start())
                if index + 1 < len(panes)
                else len(page_html)
            )
            return page_html[match.start() : end]
    raise SourceUnavailable(f"no tab for the {cycle} cycle")


def _to_text(fragment: str) -> str:
    text = html.unescape(_TAGS.sub("", _BREAKS.sub("\n", fragment)))
    lines = (line.strip() for line in text.replace("\xa0", " ").splitlines())
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()
