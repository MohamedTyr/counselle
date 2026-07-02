"""Pure routing logic — no I/O, unit-testable.

Determines whether a user message warrants the deep-research subgraph.
All functions are stateless and side-effect-free.
"""

from __future__ import annotations

import re

_EXPLICIT_PHRASES = [
    "deep research",
    "sourced report",
    "comprehensive comparison",
    "application strategy report",
]

_COMPARISON_WORDS = frozenset(
    {"compare", "versus", "vs", "comparison", "differences", "between"}
)
_STRATEGY_WORDS = frozenset(
    {
        "strategy",
        "chances",
        "aid",
        "scholarship",
        "financial aid",
        "test-optional",
        "test optional",
        "policy",
        "deadline",
        "requirements",
        "international",
    }
)
_SCHOOL_CONNECTORS = re.compile(r"\b(and|vs\.?|versus|or)\b", re.IGNORECASE)


def explicit_deep_research(text: str) -> bool:
    """True when the message contains an explicit deep-research trigger phrase."""
    lower = text.lower()
    return any(phrase in lower for phrase in _EXPLICIT_PHRASES)


def looks_like_research(text: str) -> bool:
    """Heuristic: True when the message looks like a multi-school research query.

    Requires: (comparison word OR strategy word) AND multiple capitalized tokens
    AND at least one connector word. Ambiguous messages route to normal chat.
    """
    lower = text.lower()
    has_comparison = any(w in lower for w in _COMPARISON_WORDS)
    has_strategy = any(w in lower for w in _STRATEGY_WORDS)
    words = text.split()
    capitalized = sum(1 for w in words[1:] if w and w[0].isupper() and len(w) > 2)
    connector_count = len(_SCHOOL_CONNECTORS.findall(text))
    multi_entity = capitalized >= 2 and connector_count >= 1
    return (has_comparison or has_strategy) and multi_entity
