# Backend Architecture Audit — Wave 1

Auditor: independent staff-engineer review. Scope: backend (`domain/`, `app/`,
`adapters/`, `api/`, `counselle_db/`, `config/`), with threads followed wherever
they led. Read-only analysis — no code changed.

## Headline

This is a genuinely well-architected codebase. The layering rule (ADR 0017) is
actually enforced at the import level (verified: `domain/` imports only stdlib +
pydantic; nothing inward-pointing is violated). The honesty core is concentrated
and the MCP server is a true thin shell over `service.py`. The docs are unusually
honest and current.

The problems are concentrated in **one area**: the MVP2 turn-lifecycle subsystem
(`app/turns.py`, `app/run_turn.py`, `app/agent_node.py`, `app/records.py`). That
subsystem carries the same partial-prose/turn-record logic in four places held
together by hand-written "KEEP IN SYNC" comments, and the cancel/park/edit state
machine is spread across modules with no single owner of the rules. This is where
years-of-maintenance pain and honesty-bug risk actually live. Everything else is
mostly nits and small drift.

Severity counts: **CRITICAL 0 · HIGH 4 · MEDIUM 7 · LOW 6**

---

## HIGH

### H1 — The turn-record / partial-prose logic is duplicated across four sites, coupled by "KEEP IN SYNC" comments
**Category:** DRY / maintainability / honesty-risk
**Locations:**
- `app/agent_node.py:255-267` (`_budget_partial_messages`), `:369-405` (happy-path record build)
- `app/run_turn.py:117-175` (`_write_failure_record`), `:324-352` (parked record), `:354-377` (complete record)
- `app/turns.py:502-578` (`_persist_partial`), `:656-688` (`_partial_anchor`)
- `app/records.py:108-155` (`build_turn_record`) is the shared builder, but the *wrapping* rules around it are re-implemented at each call site.

**Evidence:** The code itself flags the hazard. `app/turns.py:539-542`:
> "KEEP IN SYNC with `app.run_turn._write_failure_record` — the two write the
> partial-turn record under different vantages; a change to the record shape or
> the empty-partial rule in one must land in the other."

The "empty-partial rule" (only append a partial `ModelResponse` when prose
streamed and the tail message is a `request`) is independently re-coded in
`agent_node._budget_partial_messages` (`:263-267`), `run_turn._write_failure_record`
(`:156-161`), and `turns._persist_partial` (`:558-564`). The "prose invariant"
(messages must carry exactly what streamed) is asserted in three docstrings.
`build_turn_record` is invoked from four files.

**Why it matters:** The "prose invariant" *is* the honesty guarantee for the
transcript — "every terminal path leaves both the record's `parts[]` and
`messages` carrying exactly the prose that streamed" (ARCHITECTURE §27.7 G2). It
is enforced by four parallel implementations a human must keep aligned by reading
comments. A divergence here is precisely a lie-to-the-student bug (a reload shows
prose the student never saw, or drops prose they did), which the project says is
its one non-negotiable. The deletion-test logic the architecture is proud of (the
turn registry "concentrates complexity") does *not* hold for the record-writing
rules — those are smeared across the very modules the registry was meant to unify.

**Fix direction:** Extract one module — `app/turn_persistence.py` — that owns
*all* terminal persistence: given `(emissions, ids, status, error, clarify, graph
state snapshot)`, it computes the `messages` delta (empty-partial rule once),
builds the record (once), and returns the single `aupdate_state` payload. Every
terminal path (complete from the node, error from run_turn, cancel/timeout from
the registry, budget) calls it with a `status`. Delete the three parallel
implementations. The "two vantages" distinction is real but small — fold it into
one function with a parameter, not three copies.

---

### H2 — Cancel / park / edit state machine has no single owner; the rules are reconstructed independently across modules
**Category:** modularity / tight coupling / fragile architecture
**Locations:**
- Parked-detection: `app/run_turn.py:209-216`, `app/turns.py:596-602`, `app/turns.py:669-675`, `app/agent_node.py:243-252`
- "Replace parked record, same message_id": `app/records.py:158-175` (`append_or_replace`) **and** re-checked inline at `run_turn.py:217-218`, `turns.py:597`, `agent_node.py:245`.
- `as_node="agent"` unpark mechanic: `turns.py:615`, `turns.py:651`, and the constant `_AGENT_NODE` duplicated against `graph.py:73`'s `add_node("agent", ...)`.

**Evidence:** Four different functions independently express "the last turn record
with `status == 'awaiting_input'` means the thread is parked" (e.g.
`run_turn.py:210-213`, `turns.py:597-598`, `turns.py:670-674`,
`agent_node.py:245-246`). Each re-derives `messages_offset` fallbacks with its own
`max(len(messages) - 1, 0)` expression (`run_turn.py:255`, `turns.py:574`,
`turns.py:679`, `agent_node.py:379`).

**Why it matters:** This is the most intricate logic in the system — clarify park,
resume-replays-the-node, edit/regenerate history rewrite, cancel-on-parked,
watchdog. The architecture explicitly claims the turn registry is "one deep module
[that] owns the whole lifecycle" (§27.3). In reality the lifecycle *predicates*
(is-parked, which-record-to-replace, where-to-anchor-offset) live in run_turn, the
registry, and the node simultaneously. Changing the park representation (e.g. a
dedicated state field instead of "last record status") requires finding and
editing all four. A subtle drift produces a ghost record or a misanchored edit
slice that corrupts the message thread — the TODOS file already lists two known
corners of this exact kind ("parked-then-non-resume ghost", "double-failure
corner").

**Fix direction:** Put the lifecycle *predicates* in one place (alongside H1's
persistence module or in `records.py`): `is_parked(state) -> bool`,
`parked_record(state)`, `resolve_offset(...)`. Have run_turn, the registry, and
the node call those rather than re-deriving. Make `_AGENT_NODE` a single exported
constant imported by both `graph.py` and `turns.py` so the node name can't drift.

---

### H3 — Cross-route private-function import couples session deletion to `me.py`'s internals
**Category:** coupling / modularity
**Location:** `api/routes/sessions.py:469` — `from api.routes.me import _cancel_and_drop_threads` (a function-body import of a leading-underscore private from a sibling route module).

**Evidence:**
```python
async def delete_session_route(...):
    from api.routes.me import _cancel_and_drop_threads
    ...
    failed = await _cancel_and_drop_threads(request, [sid])
```
`_cancel_and_drop_threads` (`me.py:96-119`) is the shared "cancel live turn → drop
checkpoint thread" routine used by `DELETE /me`, `DELETE /me/chats`, and
`DELETE /sessions/{id}`.

**Why it matters:** A genuinely shared operation (cancel + drop checkpoint threads,
with the abort-and-signal honesty contract) is owned by one route module and
reached into by another via a private name and a lazy import (the lazy import is a
tell that a straight top-level import would be a smell or a cycle). Renaming or
refactoring `me.py` silently breaks chat deletion; the authz/abort contract now
has two callers but lives in neither's natural home. This is the kind of coupling
that makes route modules un-movable.

**Fix direction:** Move `_cancel_and_drop_threads` into a neutral home — e.g.
`app/sessions.py` (it operates on the registry + checkpointer, not HTTP) or a small
`app/chat_deletion.py` — and have all three routes import it as a public function.
Pass the registry + checkpointer explicitly rather than reaching through `request`.

---

### H4 — `reconcile_field_index` runs in three independent loops against the same table; `_reconcile_forever` is copy-pasted
**Category:** DRY / wrong architecture / wasted work
**Locations:**
- `api/main.py:81-104` (`_reconcile_once` + `_reconcile_forever`) — in-process loop on `app_pool`.
- `counselle_db/server.py:42-49` + `:65-69` (`_reconcile_forever`) — the MCP child's loop on the *same* `app_pool` DSN.
- `api/routes/system.py:88` — a manual admin trigger, also on `app_pool`.

**Evidence:** `api/main.py:101` docstring: "Periodic field-index reconcile (ADR
0008) — **same pattern as counselle_db/server.py**." Two near-identical
`_reconcile_forever` functions exist; both the API process and the MCP child run a
startup pass + an interval task against the identical `counselle.field_index`
table. `api/main.py:14-18`'s own comment admits the API process reconciles because
"the MCP child's own reconciler only covers the child process, not this one's
in-process service calls" — but the *reconcile target is a shared DB table*, so
both writers are doing the same upserts to the same rows on overlapping schedules.

**Why it matters:** Two processes embedding/upserting the same field index on
timers is duplicated work, double the embedding spend on every schema delta, and a
write-write race on `counselle.field_index` (the `_apply_plan` upsert in
`reconcile.py:124-141` is not coordinated across processes). The justification (the
in-process catalog needs a fresh index for `search_fields`) confuses *who reads the
index* with *who maintains it* — only one writer is needed. The copy-pasted loop is
also drift bait.

**Fix direction:** Pick exactly one reconcile owner (the API process, since it has
the supervisor and health surface) and remove the MCP child's `_reconcile_forever`
+ startup pass entirely — the child reads the index, it needn't maintain it. Hoist
the single `_reconcile_forever`/`_reconcile_once` into a shared module
(`counselle_db/reconcile.py` already exists) so there's one loop body. If a future
multi-replica deploy needs coordination, a Postgres advisory lock around
`_apply_plan` is the seam.

---

## MEDIUM

### M1 — `Catalog.maybe_refresh` / `_reload` has no concurrency guard; concurrent turns can trigger redundant full reloads and racy state swaps
**Category:** concurrency
**Location:** `counselle_db/catalog.py:179-222`.
**Evidence:** `maybe_refresh` checks `self.loaded_at`, then `await self._reload()`.
There is no lock. In the in-process catalog (shared by every `app/` service call —
`build_runtime` loads one `Catalog`), N concurrent turns that all observe a stale
`loaded_at` will each launch a full `_reload` (4 queries incl. ~2.7k school rows +
all fields). The instance-state swap (`:215-222`) is multiple assignments, not
atomic; a reader between assignments can see new `fields_by_key` with old
`scorecard_filename`.
**Why it matters:** Thundering-herd reloads under load, and a brief window of
internally-inconsistent catalog state feeding the honesty layer (vintage derived
from a stale filename against new fields). Low probability, but it's the honesty
core.
**Fix direction:** Guard `_reload` with an `asyncio.Lock` + double-check
`loaded_at` inside the lock (only the first waiter reloads). The local-then-swap
pattern is already there; doing all assignments under the lock makes the swap
effectively atomic for cooperative scheduling.

### M2 — Two `_reload`s of the same catalog at boot (in-process + MCP child), each ~3 full-table scans
**Category:** startup cost / duplication
**Locations:** `app/deps.py:77` (`Catalog.load` in `build_runtime`) and
`counselle_db/server.py:63` (`Catalog.load` in the MCP lifespan).
**Why it matters:** The catalog is loaded and refreshed twice for one logical
service (once for direct `app/` service calls, once inside the MCP child the same
process spawns). It's defensible (two processes) but doubles startup DB load and
memory for ~2,746-row maps and the full field catalog, and the two copies drift in
freshness independently. Worth noting as the cost of the in-process + MCP-child
split.
**Fix direction:** Accept it (it's inherent to the two-process design) but document
it as a known cost; or, longer term, have the child be the *only* DB toucher and
have `app/` go through it — but that contradicts the ADR-0017 carve-out and is
probably not worth it. Flagging for awareness, not urgent change.

### M3 — `run_turn` is a 235-line function with `# noqa: C901`; it is the protocol switchboard but also does session ensure, parked detection, offset math, and three record writes
**Category:** god function / testability
**Location:** `app/run_turn.py:178-413`.
**Evidence:** `:178` `async def run_turn(... # noqa: C901 — the one stream switch;
splitting hides the protocol`. The function ensures the session row, prefetches
state, detects parked, computes offsets, branches resume-vs-new, runs the stream
switch, touches the session, writes parked/error records.
**Why it matters:** The `noqa` justification ("splitting hides the protocol") only
covers the stream loop (`:271-311`). The session-ensure, parked-detection, and
record-write blocks are separable and are exactly the logic duplicated in H1/H2.
The size makes the honesty-critical paths hard to unit-test in isolation.
**Fix direction:** Keep the stream switch inline; extract `_prepare_turn_input`
(parked detection + offset + graph_input) and route persistence through H1's
module. The stream loop stays readable; the function drops well under the
complexity threshold honestly rather than via `noqa`.

### M4 — Repeated school-`SELECT` column list and ad-hoc inline SQL in the service layer
**Category:** DRY
**Location:** `counselle_db/service.py:77`, `:79-81`, `:411` — three copies of
`SELECT unitid, name, city, state, control, level FROM schools` (one inline in
`compare_schools`).
**Why it matters:** `SchoolBasics` is built from exactly these columns
(`_school_basics`, `:216-217`); if the model gains/loses a field, three SQL strings
must change in lockstep (one is buried inside a function). Low risk, pure drift
bait.
**Fix direction:** One `_SCHOOL_COLUMNS` constant (or a `_SCHOOL_SELECT(where)`
helper) used by all three. Trivial.

### M5 — `app/usage.py` moved from `api/usage.py` but `api/usage.py` remains as a re-export shim
**Category:** dead-ish code / indirection
**Locations:** `app/usage.py:7-10` (docstring: "Moved from `api/usage.py` at B2…
`api/usage.py` re-exports for existing importers"); `api/usage.py` (the shim).
**Why it matters:** A re-export shim "for existing importers" is debt unless
something outside the repo imports it. Within the repo, importers should point at
the real module. Two import paths to the same symbols invites confusion about which
is canonical.
**Fix direction:** Grep importers; repoint them at `app.usage`; delete
`api/usage.py`. If an external client truly needs it, document why; otherwise it's
just indirection.

### M6 — Per-turn `Agent` (and tool list) reconstructed on every node execution, including on every clarify resume
**Category:** performance / design
**Location:** `app/agent_node.py:283-310` — `build_tools`, the three tool-wrapper
factories, and `Agent(...)` are all rebuilt each call; on an `interrupt()` resume
LangGraph re-executes the node, so the whole agent + tool set is rebuilt and the
pre-clarify tools *re-run and are re-billed* (`:9-11` documents the replay).
**Why it matters:** It's correct (replay-safe is the whole point), but it means a
clarify round doubles model+tool spend for the turn, and agent construction
(prompt build, tool wiring, MCP toolset entry) happens per node execution. For a
cost-sensitive product (CLAUDE.md emphasizes cost), the resume-replay cost is a
real line item the architecture acknowledges but doesn't mitigate.
**Fix direction:** Mostly accept (it's the LangGraph pattern), but consider caching
the immutable parts (system prompt text, the MCP toolset object) on `deps` rather
than rebuilding, and note the resume-rebilling cost explicitly where cost is
tracked. Not a correctness issue.

### M7 — `domain/events.py` `DoneStatus` omits `error`-as-terminal nuance and duplicates status enums with `records.TurnStatus`
**Category:** type drift
**Locations:** `domain/events.py:25` `DoneStatus = Literal["complete",
"awaiting_input", "cancelled"]` vs `app/records.py:34` `TurnStatus =
Literal["complete", "awaiting_input", "cancelled", "error"]`.
**Why it matters:** Two near-identical status vocabularies (the record adds
`error`). Callers convert between them with `# type: ignore[arg-type]` (e.g.
`turns.py:567`). The relationship between a `done` event's status and a record's
status is real but implicit, and the `ignore` comments mark where the type system
gave up.
**Fix direction:** Define the record status set in terms of the wire set
(`TurnStatus = DoneStatus | Literal["error"]`) so the relationship is explicit and
the `ignore`s can go.

---

## LOW

### L1 — `.worktrees/` (1.2 GB) lives inside the repo and is not gitignored
**Category:** repo hygiene / footgun
**Evidence:** `git worktree list` shows `.worktrees/home-page` and
`.worktrees/sidebar` nested *inside* the main checkout; `du -sh .worktrees` = 1.2G;
`.gitignore` has no `worktree` entry. Every recursive grep/search in this repo
returns 2–3× duplicated hits from these trees (demonstrated during this audit).
**Why it matters:** Nested worktrees aren't tracked, but an un-ignored 1.2 GB of
near-identical source inside the repo root pollutes every tool that walks the tree
(ripgrep, mypy, ruff, IDE indexers, `find`), and one stray `git add .worktrees`
away from a disaster.
**Fix direction:** Move worktrees to a sibling path (the other three already live
at `../counselle-*`) and/or add `.worktrees/` to `.gitignore`.

### L2 — Tool-count drift in docstrings: "10 tools" / "10th tool" vs ARCHITECTURE's "11th tool"
**Category:** doc drift
**Locations:** `app/toolset.py:140` ("all 10 tools"), `counselle_db/service.py:646`
("the server's 10th tool"), `counselle_db/server.py:1` region — vs
ARCHITECTURE §8 ("the server's **11th tool**"; Layer1 `search_fields` + 8 typed +
`get_data_calendar` + `query_database` = 11). The server actually registers 11
`@mcp.tool()`s. Cosmetic but misleading.
**Fix direction:** Pick the count once (11) and fix the three docstrings.

### L3 — `thinking_summaries` doc/default contradiction across the codebase
**Category:** doc drift
**Evidence:** ARCHITECTURE §27.2 and §18 say `thinking_summaries` default **on**
("Settings-gated, default on"); `config/settings.py:74` sets it **False** with a
long comment explaining why it's off "by design". Risk-table §35 also says
"native Gemini thought summaries cut dead air to ~16s".
**Why it matters:** The architecture doc actively misdescribes a shipped default,
in the section a maintainer reads to understand the feature.
**Fix direction:** Update ARCHITECTURE §18/§27.2 to match the `False` default (or
flip the default if the doc is the intent). The settings comment is the better
source of truth.

### L4 — `get_settings` / `load_prompt` / `load_yaml_asset` share coupled `lru_cache`s with a manual "clear all three" rule
**Category:** hidden coupling
**Location:** `config/settings.py:225-239`.
**Evidence:** Inline NOTE: "get_settings/load_prompt/load_yaml_asset caches are
coupled — tests that clear one must clear all three (load_* key only on `name`,
not on assets_dir)."
**Why it matters:** A correctness footgun encoded as a comment: `load_yaml_asset`
keys on `name` but reads `get_settings().assets_dir`, so a settings change with a
different assets_dir returns stale assets unless all caches are cleared together.
Only bites tests today, but it's exactly the kind of implicit invariant that breaks
silently.
**Fix direction:** Either key the asset caches on `(assets_dir, name)` or expose one
`reset_config_caches()` helper that clears all three, used everywhere instead of
ad-hoc `.cache_clear()`.

### L5 — `EmissionRouter` defaults `kind` to `"db_tool"` for unknown tools in three separate places
**Category:** minor DRY
**Location:** `app/steps.py:129`, `:159`, `:239` each independently do
`(self._tools.get(tool_name) or self._default).get("kind", "db_tool")`.
**Why it matters:** The "unknown tool ⇒ db_tool" default is re-expressed three
times; a change to the default kind needs all three.
**Fix direction:** One `_kind_for(tool_name) -> StepKind` method.

### L6 — `query_database` SQL guard is regex-based denylist/allowlist; documented as over-rejecting, but regex SQL guarding is inherently brittle
**Category:** defense-in-depth fragility (not a vuln — RO role is the real guard)
**Location:** `counselle_db/service.py:585-611` (`_guard_sql`).
**Evidence:** Rejects `;`, non-`SELECT`/`WITH` starts, write keywords *anywhere*
(incl. inside string literals — acknowledged), and a small function denylist.
**Why it matters:** The genuine protection is the `counselle_ro` role +
`default_transaction_read_only` + statement timeout (ADR 0012), which is correct.
The regex layer adds false negatives (a write keyword in a legitimate string
literal is rejected) and a false sense of completeness (denylisting `pg_sleep` etc.
by name is whack-a-mole). It's fine as belt-and-suspenders, but shouldn't be relied
on as *the* guard.
**Fix direction:** Keep it, but ensure the RO role is the documented primary
control everywhere (it is, in the ADR). Optionally note that the regex is a UX
nicety for the LLM, not a security boundary. No change required.

---

## What's genuinely good (so the report isn't all teeth)

- **Layering is real, not aspirational.** `domain/` imports nothing inward;
  `counselle_db/` and `adapters/` never import `app/`/`api/`; the only `api/ →
  counselle_db` imports are the two ADR-0017-sanctioned ones (`main.py`,
  `system.py`). Verified by grep.
- **The MCP server is a true thin shell** (`counselle_db/server.py`) — every tool
  is a 3-liner over `service.py`. The "service is the API, MCP is a wrapper" claim
  holds.
- **The honesty choke point is single** (`service.envelope_for`, `:178-210`) — every
  value really does go through one normalize+vintage+cite path.
- **Error handling is disciplined** — terminal-event guarantees, guarded hooks,
  best-effort persistence with one retry, "never mask the original error" patterns
  are consistent and correct (the turns module especially).
- **Docs are honest and current** — designed-but-not-wired subsystems are clearly
  marked; the risk tables anticipate most of what I'd flag at the design level.
