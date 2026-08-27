"""Pure domain logic for the CDS extraction pipeline (ADR 0017 layering).

No I/O, no DB, no network, no SDK calls. Everything here is deterministic
functions and Pydantic models over already-in-memory data (YAML text, PDF
bytes, model claims). See ``specs/cds-pipeline/plan/PLAN.md`` §B1.
"""

from __future__ import annotations
