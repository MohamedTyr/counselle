# ADR 0025 — Turn persistence module

## Status

Accepted.

## Context

The turn lifecycle has several terminal paths: the agent node's normal finish,
budget stops, clarify parking, registry cancel, watchdog timeout, and unexpected
errors. Before the hardening pass, those paths duplicated the same persistence
logic in multiple places. That made transcript fidelity fragile: a small drift in
one branch could append an empty assistant response, lose streamed prose, or
record a parked turn differently from a completed turn.

The transcript is a student-facing honesty surface. It must preserve exactly the
prose that streamed and must represent terminal state consistently.

## Decision

`app/turn_persistence.py` is the single owner of terminal turn persistence and
the shared lifecycle predicates.

It owns:

- `AGENT_NODE`, the graph node anchor used for state updates.
- Parked-turn predicates (`is_parked`, `parked_record`).
- The empty-partial rule for appending streamed prose to provider history.
- `build_terminal_update`, the common payload builder for LangGraph state
  updates across terminal paths.

The turn registry, run-turn orchestration, and graph node call into this module
instead of each building terminal records independently.

## Rationale

The shared module removes duplicated "keep in sync" logic from the highest-risk
paths in the app. It keeps the invariant easy to audit: if transcript persistence
changes, there is one module to inspect and test.

This is still a small local seam, not a generic persistence framework. It exists
because the domain invariant is real and repeated across multiple runtime paths.

## Alternatives

- Keep duplicated terminal-write logic in each caller. Rejected because it already
  created drift risk around cancel, clarify, and partial transcript writes.
- Move all turn lifecycle logic out of `app/turns.py`. Rejected because the live
  registry still owns buffering, consumer attachment, cancellation, and
  single-flight state; persistence is the separable repeated part.
- Add a broader repository abstraction. Rejected as unnecessary for the current
  Postgres/LangGraph checkpointer boundary.

## Consequences

All terminal turn paths must use `app/turn_persistence.py` for record and message
updates. Tests for cancel, timeout, clarify parking, resume, and append-after-close
should assert behavior through the public registry/run-turn APIs, while pure
invariants can target this module directly.
