"""Shared rounding rule for ``domain/sat`` (plan.md §4.4, S10).

Porting trap: JS ``Math.round`` rounds half **up**; Python's built-in
``round`` rounds half to even. ``js_round(x) = floor(x + 0.5)`` matches
upstream ``Math.round`` for every quantity this package rounds, including
negative ones (``js_round(-2.5) == -2``, same as ``Math.round(-2.5)``).

Pure stdlib (ADR 0017): no I/O.
"""

from __future__ import annotations

import math


def js_round(x: float) -> int:
    """JS ``Math.round``: half rounds up, not to even."""
    return math.floor(x + 0.5)
