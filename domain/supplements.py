"""Supplemental essay prompts \u2014 the pure honesty core.

Prompts come from one compilation page, one text block per school. A model
reads each block and proposes prompts; this module decides, in code, which of
them a student may see: a prompt's text must appear in its block after
typography and whitespace are folded, and a stated word limit must appear in
the block as a number.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Literal

from pydantic import BaseModel

Requirement = Literal["required", "optional"]

_TYPOGRAPHY = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u00a0": " ",
        "\u2026": "...",
    }
)
_LIST_MARKER = re.compile(r"(?m)^\s*(?:\d+|[a-z])[.)]\s+")
#: An inline limit such as "(650 word limit)" or "(Please answer in 650 words
#: or less.)" - dropped on both sides, so a prompt copied without it still matches.
_INLINE_LIMIT = re.compile(r"\([^()]*\bwords?\b[^()]*\)", re.I)
_MARKUP = re.compile(r"[*_#>`|\u2022]+")
_WHITESPACE = re.compile(r"\s+")
_SPACE_BEFORE_PUNCT = re.compile(r" ([.,;:!?)])")


_NUMBER_WORDS = {
    word: value
    for value, word in enumerate(
        ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"], start=1
    )
}


class SupplementPrompt(BaseModel):
    """One prompt as the student will see it."""

    prompt: str
    #: Text the question refers to and the student needs to see with it (a
    #: quotation, a scenario), when the source prints it apart from the question.
    context: str | None = None
    word_limit: int | None = None
    requirement: Requirement = "required"
    #: Prompts sharing a ``group`` are one choice: the student answers
    #: ``choose_count`` of them (None: any number). ``group`` is the source's
    #: instruction for choosing. ``requirement`` says whether the whole choice
    #: (or a lone prompt) must be answered.
    group: str | None = None
    choose_count: int | None = None
    #: Who the prompt is for when not every applicant, e.g. "College of Engineering applicants".
    applies_to: str | None = None


class RejectedPrompt(BaseModel):
    prompt: str
    reason: str


def normalize(text: str) -> str:
    """Fold the differences between a page and a faithful copy of it."""
    folded = unicodedata.normalize("NFKC", text).translate(_TYPOGRAPHY)
    folded = _LIST_MARKER.sub(" ", folded)
    folded = _INLINE_LIMIT.sub(" ", folded)
    folded = _MARKUP.sub(" ", folded)
    folded = _WHITESPACE.sub(" ", folded).strip()
    return _SPACE_BEFORE_PUNCT.sub(lambda m: m.group(1), folded).casefold()


def verify_prompts(
    proposed: list[SupplementPrompt], block: str
) -> tuple[list[SupplementPrompt], list[RejectedPrompt]]:
    """Split *proposed* into prompts found verbatim in *block* and the rest.

    A word limit the block never states as a number is a rejection too: a
    limit is the one detail a student plans around, so a guessed one is worse
    than none. Duplicates keep the first occurrence.
    """
    page = normalize(block)
    numbers = set(re.findall(r"\d+", block.replace(",", "")))
    numbers |= {
        str(value)
        for word, value in _NUMBER_WORDS.items()
        if re.search(rf"\b{word}\b", block, re.I)
    }
    kept: list[SupplementPrompt] = []
    rejected: list[RejectedPrompt] = []
    seen: set[str] = set()
    for item in proposed:
        key = normalize(item.prompt)
        if not key:
            reason = "empty prompt"
        elif key not in page:
            reason = "text not found in the source block"
        elif item.context and normalize(item.context) not in page:
            reason = "context not found in the source block"
        elif item.word_limit is not None and str(item.word_limit) not in numbers:
            reason = f"word limit {item.word_limit} is not stated in the source block"
        elif key in seen:
            continue
        else:
            seen.add(key)
            kept.append(item)
            continue
        rejected.append(RejectedPrompt(prompt=item.prompt, reason=reason))
    return kept, rejected


def block_hash(block: str) -> str:
    """Fingerprint of a source block; a changed hash means re-read that school."""
    return hashlib.sha256(normalize(block).encode()).hexdigest()


def prompts_hash(prompts: list[SupplementPrompt]) -> str:
    """Order-independent fingerprint of a verified prompt set."""
    rows = sorted(
        json.dumps(
            [
                normalize(p.prompt),
                normalize(p.context or ""),
                p.word_limit,
                p.requirement,
                normalize(p.group or ""),
                p.choose_count,
                normalize(p.applies_to or ""),
            ]
        )
        for p in prompts
    )
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()
