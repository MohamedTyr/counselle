"""Pure domain logic for the CollegeData facts store (ADR 0017 layering, plan §1).

No I/O, no DB, no network, no SDK calls. Everything here is deterministic
functions and Pydantic models over already-in-memory data: normalization of
one raw CollegeData value, the five-state absence model, and reporting-period
arithmetic. See ``../../specs/school-data-v3/plan/school-data-v3.md`` §1/§4/§5.1.
"""

from __future__ import annotations
