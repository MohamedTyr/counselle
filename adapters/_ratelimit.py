"""Shared async token-bucket rate limiter for `adapters/` HTTP fetchers.

Extracted from `adapters/collegedata/fetch.py` (plan §8 enabling change
E-1) so a second fetch adapter (the SAT College Board crawl) can reuse the
same primitive rather than duplicating it.
"""

from __future__ import annotations

import asyncio
import time

__all__ = ["TokenBucket"]

# A rate-limit halving floor: at most one request per 5 minutes, so a long
# run of non-consecutive blocks across a whole pass can never stall the
# fetcher outright. Not part of any adapter's own named constants — an
# internal safety bound on `TokenBucket.halve`, never a decision anyone
# would tune.
_MAX_TOKEN_INTERVAL_S = 300.0


class TokenBucket:
    """Async single-request-per-interval rate limiter (plan §4.1's "one
    token bucket ... shared by N schools in flight"). `acquire()` blocks
    the caller until it is safe to send the next request; `halve()`
    implements a 429/403 backoff, floored so the rate never collapses to
    a full stop.
    """

    def __init__(self, rps: float) -> None:
        self._interval = 1.0 / rps
        self._lock = asyncio.Lock()
        self._next_allowed = 0.0  # monotonic time

    @property
    def rps(self) -> float:
        return 1.0 / self._interval

    def halve(self) -> None:
        self._interval = min(self._interval * 2, _MAX_TOKEN_INTERVAL_S)

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait_s = self._next_allowed - now
            if wait_s > 0:
                await asyncio.sleep(wait_s)
                now = time.monotonic()
            self._next_allowed = now + self._interval
