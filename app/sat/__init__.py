"""The SAT practice bank pipeline's app-layer orchestration (plan
plans/sat-practice/plan.md §3.2): `fetch` (this package's first
subcommand) downloads College Board's public Question Bank into
`artifacts/sat-practice/raw/`; `build`, `audit`, and `bank-sync` (added by
later work on this plan) turn that raw archive into the versioned seed
file and sync it into `counselle.sat_*`.
"""

from __future__ import annotations
