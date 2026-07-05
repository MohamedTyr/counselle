# ADR 0027 — Workspace service layer and change events

**Status:** Accepted

## Context

MVP3 adds student-owned workspace data: applications, tasks, essays, activities,
and honors. The same mutations need to serve HTTP routes now and future
PydanticAI workspace tools later. The UI also needs reliable cross-tab updates
without making in-process SSE queues the source of truth.

ADR 0023 named two in-process state owners: the turn registry and rate counters.
Workspace live updates add a third best-effort owner, so that decision needs an
explicit amendment rather than an accidental exception.

## Decision

Workspace logic lives under `app/workspace/` as plain async service functions.
Routes pass explicit pools, `user_id`, `actor`, and the workspace event bus.
Future agent tools will call the same service functions directly with
`actor="counselle"`; they will not get a separate mutation path.

Every workspace mutation records a row in `counselle.workspace_changes` inside
the same database transaction as the object write. After commit, the service
publishes a thin `ChangeEvent` to `Runtime.deps.workspace_events`. Events are
invalidation hints only; clients refetch the affected resource. SSE reconnect
replays missed events from the table by `Last-Event-ID`.

Deletes are soft archives. Application archive cascades mark linked tasks and
essays with `archived_via_application`; restore unarchives that exact set.
Retention is keep-everything until a real purge requirement exists.

ADR 0023 is amended: the service is stateless except three named in-process
owners: turn registry, rate counters, and workspace event queues. The workspace
queues are bounded and best effort; the Postgres change log is the durable
replay/audit source.

## Rationale

One service layer keeps ownership checks and actor attribution in code that both
HTTP and agent callers share. Recording the change before commit and publishing
only after commit prevents rolled-back writes from leaking to users. Keeping
events thin avoids duplicating application state in an SSE protocol.

## Alternatives

- Put workspace mutation logic in FastAPI routes first. Rejected because the
  future agent would need to re-wrap or duplicate it.
- Reuse the MVP2 turn event protocol. Rejected because turn streaming and
  workspace invalidation have different lifecycle and replay semantics.
- Build Postgres `LISTEN/NOTIFY` now. Rejected as premature for the documented
  one-instance deployment posture.

## Consequences

Horizontal scale requires replacing or backing the in-process event bus, most
likely by publishing committed rows through Postgres `LISTEN/NOTIFY` or a small
broker. The persisted change-log schema and service convention remain valid.
