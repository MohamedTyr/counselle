# Phase 3 — Backend Architecture (single-owner persistence, DRY, dead code)

> Execution: follow the per-phase loop in `plans/audit/REMEDIATION-PLAN.md` §2.2 —
> Opus implementers do the work, the gate must be green before review, ≥3 Sonnet
> reviewers must all return SHIP (quality **and** completeness) before commit.
> Implement EVERYTHING below; miss nothing.
>
> **This phase is a behavior-preserving refactor.** It changes the *shape* of the
> code (who owns the persistence/lifecycle rules, where the constants live) but
> NOT what the student-facing product does. The transcript a reload renders, the
> records every terminal path writes, the wire events, the SSE protocol — all
> stay byte-identical. The single highest risk is that an extraction silently
> changes a record's `parts[]`, `messages` delta, `messages_offset`, `clarify`,
> or `status`. Every extraction therefore ships with an equivalence test, and the
> entire existing turn-lifecycle suite (`tests/app/test_turns.py`,
> `tests/app/test_run_turn.py`, `tests/app/test_records.py`) MUST stay green
> unchanged (do not edit those tests to "make them pass" — if one breaks, the
> refactor changed behavior and is wrong).
>
> **Build on Phase 1.** Phase 1 (`plans/audit/phase-1-lifecycle-correctness.md`)
> already fixed the runtime races in these exact functions: the ring-buffer
> bound (BC-01), the append-after-close guard (BC-05), the concurrent-cancel
> single-flight (BC-03/BC-04), the cross-turn Last-Event-ID (BC-06), the
> pre-start route writes (BC-12), the persist timeout (BC-08), the shutdown-drain
> mislabel (BC-15). Phase 3 must preserve every Phase-1 fix while moving the code
> around. See **Cross-phase notes** at the end for the exact seams to respect.

---

## Scope & files touched

**New files**
- `app/turn_persistence.py` — the single owner of all terminal turn persistence
  (the `messages` delta + empty-partial rule, the record build, the one
  `aupdate_state` payload) AND the lifecycle predicates (`is_parked`,
  `parked_record`, `resolve_offset`, the `_AGENT_NODE` constant).
- `app/chat_deletion.py` — the neutral home for `cancel_and_drop_threads`
  (moved out of `api/routes/me.py`).
- `tests/app/test_turn_persistence.py` — unit + equivalence tests for the new module.
- `tests/app/test_chat_deletion.py` — unit test for the moved deletion helper.

**Modified files**
- `app/turns.py` — call `turn_persistence` for `_persist_partial`; drop
  `_partial_anchor`'s re-derivation; import `_AGENT_NODE` from the new module;
  use `is_parked`/`parked_record` predicates.
- `app/run_turn.py` — call `turn_persistence` for `_write_failure_record` and the
  parked-record write; extract `_prepare_turn_input`; drop the OR-on-interrupt
  parked fallback (record-is-source-of-truth); fix the resume-failure orphan
  (BC-11); remove or honestly justify the `# noqa: C901`.
- `app/agent_node.py` — call `turn_persistence` for the budget-partial messages
  rule; use `resolve_offset`.
- `app/records.py` — `TurnStatus = DoneStatus | Literal["error"]` (M7); keep
  `build_turn_record`/`append_or_replace` (they are already the shared builder).
- `app/graph.py` — import + use the shared `AGENT_NODE` constant for `add_node`.
- `domain/events.py` — re-export nothing new; `DoneStatus` stays the wire source.
- `app/usage.py` — unchanged (the real module).
- `api/usage.py` — **deleted** (M5 shim).
- `tests/api/test_usage.py` — repointed to `app.usage`.
- `api/routes/me.py` — import `cancel_and_drop_threads` from `app/chat_deletion.py`.
- `api/routes/sessions.py` — same import (drop the lazy `from api.routes.me ...`).
- `api/main.py` — keep the single reconcile loop; hoist its body into
  `counselle_db/reconcile.py`; it remains the ONE reconcile owner.
- `counselle_db/server.py` — **remove** `_reconcile_forever` + the startup
  reconcile pass (the MCP child reads the index, it doesn't maintain it).
- `counselle_db/reconcile.py` — add `reconcile_once` + `reconcile_forever`
  (the hoisted loop body) so there is one implementation.
- `counselle_db/catalog.py` — add an `asyncio.Lock` around `_reload` with a
  double-check on `loaded_at` (M1).
- `counselle_db/service.py` — one `_SCHOOL_COLUMNS`/`_SCHOOL_SELECT` helper (M4).
- `app/steps.py` — one `_kind_for(tool_name)` method (L5).
- `config/settings.py` — `reset_config_caches()` helper or `(assets_dir, name)`
  cache keys (L4).

**Leave-alone (do NOT "fix" — restated so reviewers don't flag as misses):**
M2 (double catalog load — inherent to the two-process design), M6 (per-turn
agent rebuild — the LangGraph replay pattern), L6/DS-07 (the regex SQL guard is
belt-and-suspenders; the RO role is the real control). These are in the master
matrix's accept list (`REMEDIATION-PLAN.md` §3).

DS-11 (catalog serves stale data on refresh failure — serve-stale is the correct
availability tradeoff; monitored via /v1/health; no code change — see master plan
§3). Relevant here because M1 edits `counselle_db/catalog.py`; do NOT change the
serve-stale behavior while touching that file.

---

## Gate commands (for this phase)

```bash
# Backend (the whole phase is backend)
uv run ruff check .
uv run mypy .                       # must be green; M7 removes a `# type: ignore`
uv run pytest -m "not live_llm and not live_search" \
    tests/app tests/api tests/counselle_db tests/config
# Full routine suite once, before review hand-off:
uv run pytest -m "not live_llm and not live_search"
```

A reviewer MUST see the full routine suite green, and MUST confirm
`tests/app/test_turns.py`, `tests/app/test_run_turn.py`,
`tests/app/test_records.py` pass **without edits** (the equivalence proof).

---

## Findings & fixes

Order: HIGH → MEDIUM → LOW.

---

### H1 / BC-09 — Extract one module that owns ALL terminal turn persistence  [HIGH]

- **Files:** `app/turn_persistence.py` (new); `app/turns.py:528-578` & `:656-688`;
  `app/run_turn.py:117-175` & `:324-352`; `app/agent_node.py:255-267` & `:369-405`;
  `app/records.py` (shared builder, unchanged in shape).

- **Problem:** The partial-prose / turn-record persistence logic is implemented
  **four times**, held together by hand-written "KEEP IN SYNC" comments
  (`app/turns.py:539-542`). The "empty-partial rule" (append a partial
  `ModelResponse` only when prose streamed AND the tail message is a `request`)
  is independently re-coded in:
  - `app/agent_node.py:263-267` (`_budget_partial_messages`),
  - `app/run_turn.py:156-161` (`_write_failure_record`),
  - `app/turns.py:558-564` (`_persist_partial`).

  The `messages_offset` fallback (`max(len(messages) - 1, 0)`) is re-derived in
  four places (`run_turn.py:155`, `turns.py:574`, `turns.py:679`,
  `agent_node.py:379`). `build_turn_record` is called from four files with
  slightly different wrapping each time. The prose invariant ("every terminal
  path leaves the record's `parts[]` and `messages` carrying exactly the prose
  that streamed", ARCHITECTURE §27.7 G2) IS the honesty guarantee for the
  transcript — enforced by four parallel implementations a human keeps aligned by
  reading comments. A divergence here is a lie-to-the-student bug (reload shows
  prose the student never saw, or drops prose they did).

- **Fix (EXACT):**

  Create `app/turn_persistence.py` as the single owner. It contains the
  empty-partial rule ONCE, the lifecycle predicates (shared with H2), and one
  function per persistence shape. The "two vantages" distinction (in-process
  emissions in the node vs wire-event emissions in the registry/run_turn) is real
  but small: both observe the same ordered `Emission` list, so they call the same
  function — the vantage is just *who collected the emissions*, not a different
  code path.

  **New module interface (`app/turn_persistence.py`):**

  ```python
  """Single owner of terminal turn persistence + the lifecycle predicates.

  Every terminal path — the node's happy/budget path, run_turn's parked and
  error writes, the registry's cancel/timeout — builds the same record shape and
  the same `messages` delta through THIS module. The empty-partial rule and the
  offset anchoring live here once (was: four "KEEP IN SYNC" copies, audit H1).

  The transcript is the honesty surface (ARCHITECTURE §27.7 G2): the prose
  invariant — `messages` keeps exactly the prose that streamed — is enforced in
  `partial_messages` and nowhere else.
  """
  from __future__ import annotations

  from typing import Any

  from pydantic_ai.messages import (
      ModelMessagesTypeAdapter,
      ModelResponse,
      TextPart,
  )

  from app.records import (
      Emission,
      TurnStatus,
      append_or_replace,
      build_turn_record,
      now_iso,
  )

  #: The LangGraph agent node name — MUST equal app.graph's add_node("agent", …).
  #: The `as_node=` anchor for unpark / history-rewrite (the graph must believe
  #: the agent ran). Single source of truth; imported by graph.py and turns.py.
  AGENT_NODE = "agent"


  # -- lifecycle predicates (shared with H2) --------------------------------

  def is_parked(records: list[dict[str, Any]]) -> bool:
      """The thread is parked on a clarify iff the last record is awaiting_input.

      The turn record is the single source of truth (B0 spike 1: the parked
      record write empties tasks[*].interrupts). No interrupt-fallback OR — see
      audit BC-14 / H2.
      """
      return bool(records) and records[-1].get("status") == "awaiting_input"


  def parked_record(records: list[dict[str, Any]]) -> dict[str, Any] | None:
      """The parked clarify record, or None when the thread is not parked."""
      return records[-1] if is_parked(records) else None


  def resolve_offset(
      explicit: int | None, messages: list[dict[str, Any]]
  ) -> int:
      """The turn's messages_offset: the caller's authoritative value when it has
      one, else the tail-request fallback (the user ModelRequest is the tail on a
      new turn; for direct-graph invocations the len-1 fallback covers it)."""
      if isinstance(explicit, int):
          return explicit
      if messages and messages[-1].get("kind") == "request":
          return len(messages) - 1
      return len(messages)


  # -- the empty-partial rule (the prose invariant) -------------------------

  def partial_messages(
      messages: list[dict[str, Any]], emissions: list[Emission]
  ) -> tuple[list[dict[str, Any]], bool]:
      """Apply the empty-partial rule once.

      Returns `(messages, changed)`. Appends a partial ModelResponse carrying the
      concatenated delta prose ONLY when prose streamed AND the tail message is a
      `request` to anchor it. No prose (or no request tail) → unchanged
      (an empty-content response corrupts the provider history).
      """
      prose = "".join(text for kind, text in emissions if kind == "delta")
      if not prose or not messages or messages[-1].get("kind") != "request":
          return messages, False
      partial = ModelResponse(parts=[TextPart(content=prose)])
      appended = messages + list(
          ModelMessagesTypeAdapter.dump_python([partial], mode="json")
      )
      return appended, True


  # -- the one aupdate_state payload builder --------------------------------

  def build_terminal_update(
      *,
      messages: list[dict[str, Any]],
      records: list[dict[str, Any]],
      emissions: list[Emission],
      ids: dict[str, Any],
      status: TurnStatus,
      sources: list[dict[str, Any]],
      user_text: str | None,
      messages_offset: int | None,
      usage: dict[str, Any] | None = None,
      error: dict[str, Any] | None = None,
      clarify: dict[str, Any] | None = None,
      synthesized_answer: bool = False,
  ) -> dict[str, Any]:
      """The single `aupdate_state` payload for ANY terminal path.

      Computes the messages delta (empty-partial rule), builds the record, and
      returns `{"turn_records": …, ["messages": …]}` — messages key present only
      when the partial actually changed it. The caller passes the snapshot's
      `messages`/`records` and the emissions it observed; nothing else differs
      across vantages.
      """
      new_messages, changed = partial_messages(messages, emissions)
      record = build_turn_record(
          emissions,
          ids=ids,
          status=status,
          sources=sources,
          user_text=user_text,
          usage=usage,
          error=error,
          clarify=clarify,
          ts=now_iso(),
          messages_offset=resolve_offset(messages_offset, new_messages),
          synthesized_answer=synthesized_answer,
      )
      update: dict[str, Any] = {"turn_records": append_or_replace(records, record)}
      if changed:
          update["messages"] = new_messages
      return update
  ```

  Notes for the implementer:
  - `resolve_offset` is computed against `new_messages` so the offset accounts for
    a just-appended partial only if the caller relied on the fallback; when the
    caller passes an explicit offset (the normal path) the messages length is
    irrelevant. This matches every current call site's behavior — verify with the
    equivalence test below.
  - `build_terminal_update` does NOT do I/O. The callers own `aget_state` /
    `aupdate_state` (they each have their own guard/retry/timeout policy from
    Phase 1 — do not move those into this module).
  - Keep the `# type: ignore[arg-type]` OFF: M7 makes `TurnStatus` accept the
    literals these callers pass, so no ignore is needed here.

  **Call-site replacement — `app/run_turn.py` `_write_failure_record` (`:117-175`):**

  Before (abridged): the function does `aget_state`, restores `fallback_messages`
  when the input checkpoint never landed, applies the empty-partial rule inline,
  builds the record inline, writes. After:

  ```python
  async def _write_failure_record(
      graph: Any,
      config: dict[str, Any],
      *,
      emissions: list[Emission],
      ids: dict[str, Any],
      user_text: str | None,
      trace_id: str,
      messages_offset: int | None,
      fallback_messages: list[dict[str, Any]] | None,
      registry_dump: list[Any],
  ) -> None:
      prose = "".join(text for kind, text in emissions if kind == "delta")
      if not user_text and not prose:
          logger.info("skipping anchorless empty error record (trace_id=%s)", trace_id)
          return
      snapshot = await graph.aget_state(config)
      messages = list(snapshot.values.get("messages") or []) if snapshot else []
      records = list(snapshot.values.get("turn_records") or []) if snapshot else []
      # The run died before the input checkpoint landed — restore the turn's
      # input so the record's offset points at a real user message.
      if fallback_messages is not None and len(messages) < len(fallback_messages):
          messages = list(fallback_messages)
      update = build_terminal_update(
          messages=messages,
          records=records,
          emissions=emissions,
          ids=ids,
          status="error",
          sources=registry_dump,
          user_text=user_text,
          messages_offset=messages_offset,
          error={"message": _USER_SAFE_ERROR, "trace_id": trace_id},
      )
      await graph.aupdate_state(config, update)
  ```

  IMPORTANT equivalence subtlety: the old code set `messages_dirty=True` and wrote
  `messages` whenever it restored `fallback_messages`, **even if the empty-partial
  rule did not append anything**. `build_terminal_update` only sets `messages` when
  `partial_messages` changed it. To preserve behavior exactly, when
  `fallback_messages` was restored the caller MUST still write the restored
  `messages` even with no partial. Handle this by passing the restored `messages`
  and, if `"messages" not in update` after the call, set it explicitly:

  ```python
      update = build_terminal_update(... messages=messages ...)
      if fallback_messages is not None and len(...restored...):
          update.setdefault("messages", messages)   # restore even with no partial
      await graph.aupdate_state(config, update)
  ```
  (Adapt to the real variable; the rule is: a fallback restore always persists the
  restored `messages`, regardless of the partial. Cover it with a test.)

  **Call-site replacement — `app/run_turn.py` parked-record write (`:324-352`):**

  ```python
      if interrupted:
          yield ev_done("awaiting_input")
          try:
              update = build_terminal_update(
                  messages=[],            # parked write never touches messages
                  records=prior_records,
                  emissions=emissions,
                  ids=turn_ids,
                  status="awaiting_input",
                  sources=last_registry_dump,
                  user_text=record_user_text,
                  messages_offset=messages_offset,
                  clarify={"spec": clarify_dump, "answer": None} if clarify_dump else None,
              )
              # The parked write only writes the record, never messages.
              await graph.aupdate_state(config, {"turn_records": update["turn_records"]})
          except Exception:
              logger.error(... "parked turn-record write failed" ...)
          return
  ```
  (The parked path historically wrote only `turn_records` — preserve that: pass
  `messages=[]` so the empty-partial rule is a no-op, and write only
  `turn_records`. A test must assert the parked write does not mutate `messages`.)

  **Call-site replacement — `app/turns.py` `_persist_partial` (`:528-578`):**

  ```python
  async def _persist_partial(
      self, turn: _Turn, *, status: str, error: dict[str, Any] | None
  ) -> None:
      if turn.ids is None:
          logger.info("skipping pre-meta partial record (session_id=%s)", turn.session_id)
          return
      config = {"configurable": {"thread_id": turn.session_id}}
      snapshot = await self._graph.aget_state(config)
      values = dict(snapshot.values) if snapshot else {}
      messages = list(values.get("messages") or [])
      records = list(values.get("turn_records") or [])
      registry_dump = list(values.get("source_registry") or [])
      user_text, offset, clarify, synthesized = _partial_anchor(turn, messages, records)
      update = build_terminal_update(
          messages=messages,
          records=records,
          emissions=turn.emissions,
          ids=turn.ids,
          status=cast("TurnStatus", status),
          sources=registry_dump,
          user_text=user_text,
          messages_offset=offset,
          error=error,
          clarify=clarify,
          synthesized_answer=synthesized,
      )
      await self._graph.aupdate_state(config, update)
  ```
  Delete the inline empty-partial block (`:557-564`) and the inline
  `build_turn_record` call (`:565-577`). Delete the "KEEP IN SYNC" comment block
  (`:537-542`) — there is now one implementation. `_partial_anchor` stays (it is
  the cancel-vs-resume anchoring logic, H2's concern) but its `max(len-1,0)`
  fallback for `offset` is now redundant with `resolve_offset`; keep
  `_partial_anchor` returning the parked offset and let `build_terminal_update`'s
  `resolve_offset` apply the fallback (so `_partial_anchor` can return `None` for
  the offset when the parked record had none — verify the equivalence test).

  **Call-site replacement — `app/agent_node.py` budget path (`:255-267`, `:367`):**

  Delete `_budget_partial_messages` entirely. Replace its one call site
  (`:367`, `messages_out = _budget_partial_messages(state["messages"], emissions)`)
  with:

  ```python
      from app.turn_persistence import partial_messages
      messages_out, _ = partial_messages(state["messages"], emissions)
  ```
  (Import at module top, not inline.) The node's happy-path record build
  (`:385-396`) already calls `build_turn_record` directly and is the canonical
  shape — leave it, but route its `offset` fallback through `resolve_offset`
  (see H2). Do NOT route the node's *happy-path* `aupdate_state` return dict
  through `build_terminal_update` — the node returns a state delta with extra keys
  (`source_registry`, `viz_emitted`, `usage`, `pending_clarify`), not a bare
  terminal update; it correctly uses `build_turn_record` + `append_or_replace`
  inline. The shared piece for the node is `partial_messages` and `resolve_offset`,
  which it now imports.

- **Tests to add/keep-green** (`tests/app/test_turn_persistence.py`):
  - `partial_messages` appends a partial ModelResponse iff prose + request tail.
  - `partial_messages` returns `(messages, False)` for: no prose; prose but tail
    is a response; empty messages.
  - `build_terminal_update` sets `messages` key iff the partial changed it.
  - `build_terminal_update` produces a record whose `parts[]`, `status`,
    `clarify`, `messages_offset` match a hand-built `build_turn_record` for the
    same inputs (the equivalence anchor).
  - **Equivalence test (the headline):** for each terminal status
    (`complete` via node-shape inputs, `error`, `cancelled`, `awaiting_input`),
    assert the record produced via `build_terminal_update` is `==` to the record
    the pre-refactor inline code produced for the same `(emissions, ids, sources,
    user_text, offset, clarify)`. Encode the pre-refactor expected dict literally
    in the test so a future drift is caught.
  - **Keep green unchanged:** all of `tests/app/test_turns.py`,
    `tests/app/test_run_turn.py`, `tests/app/test_records.py`. These already cover
    cancel-persists-partial, cancel-before-prose-skips-append,
    cancel-mid-resume-replaces-parked, watchdog-error, parked-record-durable,
    error-record. If any needs editing to pass, the refactor changed behavior —
    stop and fix the refactor, not the test.

- **Acceptance criteria:**
  - [ ] `app/turn_persistence.py` exists with `partial_messages`,
        `build_terminal_update`, `is_parked`, `parked_record`, `resolve_offset`,
        `AGENT_NODE`.
  - [ ] `_budget_partial_messages` deleted; `agent_node` imports `partial_messages`.
  - [ ] The empty-partial rule appears in exactly ONE place (grep:
        `messages[-1].get("kind") == "request"` for the partial append appears
        once, in `turn_persistence.partial_messages`).
  - [ ] The "KEEP IN SYNC" comment is gone from `turns.py`.
  - [ ] `run_turn._write_failure_record`, `run_turn` parked write, and
        `turns._persist_partial` all route through `build_terminal_update`.
  - [ ] The fallback-restore-writes-messages behavior is preserved (test).
  - [ ] The parked write still writes only `turn_records` (test).
  - [ ] Full routine suite green; the three lifecycle test files pass unedited.

---

### H2 / BC-11 / BC-14 — Lifecycle predicates get one owner; resume-failure orphan fixed; parked-detection OR desync removed  [HIGH]

- **Files:** `app/turn_persistence.py` (predicates, from H1);
  `app/run_turn.py:203-216`, `:243-258`; `app/turns.py:596-602`, `:642-644`,
  `:669-675`; `app/agent_node.py:243-252` (`_resume_clarify`), `:377-379`;
  `app/graph.py:72-73`; `app/turns.py:72` (`_AGENT_NODE`).

- **Problem (three threads):**
  1. **No predicate owner (H2).** Four functions independently express "the last
     turn record with `status == 'awaiting_input'` means the thread is parked"
     (`run_turn.py:209-213`, `turns.py:596-598`, `turns.py:669-674`,
     `agent_node.py:245-246`) and each re-derives the `messages_offset` fallback.
     The `_AGENT_NODE = "agent"` constant in `turns.py:72` is duplicated against
     `graph.py:73`'s `add_node("agent", …)` — a rename of the node silently
     breaks unpark/rewrite.
  2. **Resume-failure clarify-orphan (BC-11).** `run_turn.py:257`'s pre-run
     `aupdate_state({"turn_ids": {…, "resume_text": …}})` is inside the main try;
     if it fails, control jumps to the generic handler which calls
     `_write_failure_record` → appends an *error* record AFTER the still-parked
     `awaiting_input` record. The next message's parked-detection sees the error
     record last → thread treated as NOT parked → the clarify is orphaned (the
     student answered, hit a blip, and the agent forgot it was asking).
  3. **Parked-detection OR desync (BC-14).** `run_turn.py:214` ORs the record
     signal with `snapshot.tasks[*].interrupts`. On a torn write (record frozen
     to `cancelled` but the interrupt-clear not committed), the stale interrupt
     wins via the OR → resume path with no parked record. The docstring itself
     calls the interrupt check a "pre-B1b fallback". The record is now always the
     writer; drop the OR.

- **Fix (EXACT):**

  **(a) Single predicate owner + shared node constant.** Add `is_parked`,
  `parked_record`, `resolve_offset`, `AGENT_NODE` to `app/turn_persistence.py`
  (already specified in H1).

  - `app/graph.py`: import and use the constant.
    ```python
    from app.turn_persistence import AGENT_NODE
    ...
    graph.add_node(AGENT_NODE, agent)   # was: add_node("agent", agent)
    graph.add_edge("prepare", AGENT_NODE)
    graph.add_edge(AGENT_NODE, END)
    ```
  - `app/turns.py`: delete the local `_AGENT_NODE = "agent"` (`:72`); import
    `AGENT_NODE` from `app.turn_persistence` and replace both `as_node=_AGENT_NODE`
    uses (`:615`, `:651`). Update the two docstrings that say `as_node="agent"`.
  - Replace the inline parked checks:
    - `turns.py:596-598` (`_unpark_if_parked`): `parked = parked_record(records)`.
    - `turns.py:669-674` (`_partial_anchor`): keep the *resume* distinction (it
      additionally checks `message_id == ids.message_id`), but use `is_parked` for
      the base "last is awaiting_input" test and `resolve_offset` for the offset
      fallback.
    - `agent_node.py:245-246` (`_resume_clarify`): it already checks
      `status == "awaiting_input"` + id match — fine to leave as-is (it is the
      resume-replace predicate, not the bare parked predicate), but pull the
      `offset` fallback (`:377-379`) through `resolve_offset`:
      ```python
      offset = resolve_offset(ids.get("messages_offset"), state["messages"])
      ```

  **(b) run_turn parked detection — record is source of truth (BC-14).**
  Extract into `_prepare_turn_input` (see M3) and use the predicate:
  ```python
  parked = parked_record(prior_records)   # was the OR-with-interrupts expression
  if parked is not None:
      message_id = str(parked["message_id"])
  ```
  Delete the `bool(snapshot and any(task.interrupts for task in snapshot.tasks))`
  OR (`run_turn.py:214-216`). Update the module docstring (`:5-8`) and the inline
  comment (`:206-208`) to drop the "interrupts fallback" language — the record is
  the sole signal. Mirror this in `_rewrite_history` (`turns.py:642-644`): drop
  the `or any(task.interrupts …)` clause; `parked = is_parked(records)`.

  **(c) Resume-failure orphan (BC-11).** The pre-run resume `aupdate_state` must
  NOT, on failure, leave an error record appended after the parked record. Two
  parts:
  - Wrap the pre-run resume write so its failure is handled distinctly from a
    mid-stream failure. On failure, `yield ev_error(...)` and **return without
    writing any record** — the parked `awaiting_input` record stays the last
    record, so the thread is still parked and the student can retry the answer:
    ```python
    if parked is not None:
        ... compute messages_offset ...
        turn_ids = {**turn_ids, "messages_offset": messages_offset}
        try:
            await graph.aupdate_state(
                config, {"turn_ids": {**turn_ids, "resume_text": user_text}}
            )
        except Exception:
            logger.exception(
                "resume pre-write failed — leaving the thread parked "
                "(trace_id=%s, session_id=%s)", trace_id, session_id,
            )
            yield ev_error(_USER_SAFE_ERROR, trace_id)
            return
        graph_input = Command(resume=user_text)
    ```
  - Belt-and-suspenders: `append_or_replace` already REPLACES the last record when
    it is `awaiting_input` with the same `message_id` (`records.py:169-174`). So
    even if `_write_failure_record` ran on a resume, it would REPLACE the parked
    record (the resume reuses the parked `message_id`) rather than append after it
    — but only if the error record carries that `message_id`. The clean fix above
    (return before any record write) is the primary; do not rely on the replace.
    Add a test that proves the parked record survives a failed resume pre-write.

- **Tests to add/keep-green:**
  - `is_parked` / `parked_record`: true on `awaiting_input` tail, false otherwise,
    false on empty.
  - `resolve_offset`: explicit int wins; request-tail → `len-1`; response-tail →
    `len`; empty → `0`.
  - **BC-11 regression:** a resume whose pre-run `aupdate_state` raises ends the
    stream with `ev_error` AND leaves the last record `awaiting_input` (thread
    still parked); a subsequent normal message is detected as a resume, not a new
    turn. (Use the FunctionModel + a graph whose `aupdate_state` raises once.)
  - **BC-14 regression:** with a record frozen to `cancelled` but a stale
    interrupt still present in `snapshot.tasks`, `run_turn` treats the thread as
    NOT parked (record wins; no OR re-trip). Add to `tests/app/test_run_turn.py`
    or the new module's integration test.
  - Node-name drift guard: a test asserting `AGENT_NODE` equals the node the
    compiled graph registered (introspect `graph.get_graph().nodes` or assert
    `add_node` was called with `AGENT_NODE`). Keep `test_turns.py` unpark/rewrite
    tests green.

- **Acceptance criteria:**
  - [ ] `is_parked`/`parked_record`/`resolve_offset`/`AGENT_NODE` live in
        `turn_persistence` and are the only definitions (grep: no second
        `_AGENT_NODE`, no second `== "awaiting_input"` parked derivation outside
        the predicates + the resume-replace id-matched checks).
  - [ ] `graph.py` and `turns.py` import the shared `AGENT_NODE`.
  - [ ] The OR-on-interrupt parked fallback is gone from `run_turn` and
        `_rewrite_history`; the record is the sole parked signal.
  - [ ] A failed resume pre-write leaves the thread parked (BC-11 test green).
  - [ ] A torn-write stale interrupt does not re-trip resume (BC-14 test green).
  - [ ] Existing unpark/rewrite/resume tests pass unedited.

---

### H3 — Move `_cancel_and_drop_threads` to a neutral, public home  [HIGH]

- **Files:** `api/routes/me.py:96-119` (source); `api/routes/sessions.py:469`
  (lazy private import); `api/routes/me.py:133`, `:154` (its two other callers);
  `app/chat_deletion.py` (new); `api/main.py` (no change needed — the registry &
  checkpointer already live on `app.state`).

- **Problem:** `delete_session_route` reaches into a sibling route module's
  private with a lazy import: `from api.routes.me import _cancel_and_drop_threads`
  (`sessions.py:469`). The function is a genuinely shared operation (cancel live
  turn → drop checkpoint thread, with the abort-and-signal honesty contract) used
  by `DELETE /me`, `DELETE /me/chats`, and `DELETE /sessions/{id}`, but it lives
  in one route and is reached by another via a private name. The lazy import is a
  tell that a top-level import would be a smell or a cycle. Renaming `me.py`
  silently breaks chat deletion.

- **Fix (EXACT):** Move it to `app/chat_deletion.py` as a public function that
  takes the registry and checkpointer explicitly (it operates on those, not on
  HTTP — so it belongs in `app/`, the layer below `api/`).

  **New file `app/chat_deletion.py`:**
  ```python
  """Shared chat/account deletion primitive (audit H3).

  Cancel any in-flight turn FIRST (a live task must not checkpoint after
  adelete_thread), then drop each session's checkpoint thread. Returns the
  session ids whose adelete_thread FAILED so the caller can abort-and-signal
  (rows intact, retryable) — the me.py honesty contract, now owned in one place
  and reachable by every route without a cross-route private import.
  """
  from __future__ import annotations

  import structlog

  logger = structlog.get_logger(__name__)


  async def cancel_and_drop_threads(
      registry: object, checkpointer: object, session_ids: list[str]
  ) -> list[str]:
      failed: list[str] = []
      for sid in session_ids:
          try:
              await registry.cancel(sid)   # type: ignore[attr-defined]
          except Exception:
              logger.exception("registry cancel failed during delete", session_id=sid)
          try:
              await checkpointer.adelete_thread(sid)   # type: ignore[attr-defined]
          except Exception:
              logger.exception("adelete_thread failed during delete", session_id=sid)
              failed.append(sid)
      return failed
  ```
  (If `TurnRegistry` and the checkpointer have importable types without a cycle,
  type them properly instead of `object` + ignores. `TurnRegistry` is in
  `app/turns.py` — same layer, importable. The checkpointer is
  `AsyncPostgresSaver | MemorySaver`; `Any` is acceptable.)

  **`api/routes/me.py`:** delete `_cancel_and_drop_threads` (`:96-119`). At the
  three call sites pass the registry + checkpointer from `request.app.state`:
  ```python
  from app.chat_deletion import cancel_and_drop_threads
  ...
  failed = await cancel_and_drop_threads(
      request.app.state.turn_registry,
      request.app.state.runtime.checkpointer,
      session_ids,
  )
  ```
  Apply to `delete_me` (`:133`) and `delete_my_chats` (`:154`).

  **`api/routes/sessions.py`:** replace the lazy private import (`:469`) with a
  top-level `from app.chat_deletion import cancel_and_drop_threads` and:
  ```python
  failed = await cancel_and_drop_threads(
      request.app.state.turn_registry,
      request.app.state.runtime.checkpointer,
      [sid],
  )
  ```

- **Tests to add/keep-green** (`tests/app/test_chat_deletion.py`):
  - Returns `[]` when all `adelete_thread` succeed.
  - Returns the failed sids when `adelete_thread` raises for some; still attempts
    every sid (no early break).
  - A `registry.cancel` failure is logged-and-tolerated (does NOT add to failed,
    does NOT stop the thread drop).
  - Keep green: the existing delete-route tests in `tests/api/` (find them; they
    exercise the abort-500 path — they must still pass through the new import).

- **Acceptance criteria:**
  - [ ] `app/chat_deletion.py` exists with a public `cancel_and_drop_threads`.
  - [ ] `api/routes/me.py` has no `_cancel_and_drop_threads`; all 3 routes import
        the public function.
  - [ ] No `from api.routes.me import` anywhere (grep).
  - [ ] Registry + checkpointer passed explicitly (no `request` param inside the
        primitive).
  - [ ] Existing delete-route tests + new unit tests green.

---

### H4 — One reconcile owner; remove the MCP child's reconciler; hoist the loop  [HIGH]

- **Files:** `api/main.py:81-104` (`_reconcile_once` + `_reconcile_forever`);
  `counselle_db/server.py:42-49` + `:64-76` (the child's `_reconcile_forever` +
  startup pass); `counselle_db/reconcile.py` (the hoist target);
  `api/routes/system.py:88` (manual admin trigger — keep, calls
  `reconcile_field_index` directly).

- **Problem:** `reconcile_field_index` runs in three independent loops against the
  same `counselle.field_index` table — the API process (`main.py`), the MCP child
  (`server.py`), and the admin trigger. The API process and the MCP child each run
  a startup pass + an interval task, embedding/upserting the SAME rows on
  overlapping schedules: duplicated work, double embedding spend on every schema
  delta, and a write-write race on `_apply_plan` (`reconcile.py:124-141`,
  uncoordinated across processes). `_reconcile_forever` is copy-pasted in both
  (the `main.py:101` docstring even says "same pattern as
  counselle_db/server.py"). The justification (the in-process catalog needs a
  fresh index for `search_fields`) confuses *who reads the index* with *who
  maintains it* — only one writer is needed.

- **Fix (EXACT):**

  1. **Hoist the loop body into `counselle_db/reconcile.py`** (the single home).
     Add the wrapper functions there, keeping the API's `ReconcilerState` health
     surface working:
     ```python
     # counselle_db/reconcile.py  (additions)
     import asyncio
     from typing import Any

     async def reconcile_once(
         app_pool: asyncpg.Pool, on_result: Any = None, on_error: Any = None
     ) -> None:
         """One reconcile pass; never raises (keyword fallback serves when the
         index lags). The optional callbacks let the API record health state.

         NOTE: single-writer by design (audit H4). The API process is the ONLY
         reconcile owner; the MCP child reads the index, it doesn't maintain it.
         A future multi-replica deploy needs a Postgres advisory lock around
         _apply_plan — that is the coordination seam.
         """
         try:
             result = await reconcile_field_index(app_pool)
             if on_result is not None:
                 on_result(result)
         except Exception as exc:
             if on_error is not None:
                 on_error(exc)
             else:
                 logger.exception("field_index reconcile failed — keyword fallback serves")

     async def reconcile_forever(
         app_pool: asyncpg.Pool, interval_minutes: int,
         on_result: Any = None, on_error: Any = None,
     ) -> None:
         """Periodic reconcile (ADR 0008) — the one loop body (audit H4)."""
         while True:
             await asyncio.sleep(interval_minutes * 60)
             await reconcile_once(app_pool, on_result, on_error)
     ```
     Keep the API's class-name-only error masking (the full message may contain
     DSNs/hosts) by having `api/main.py` pass an `on_error` that sets
     `state.last_error = type(exc).__name__` and logs `repr(exc)` — that masking
     logic is an API concern, so it stays in `main.py`, not the shared module.

  2. **`api/main.py`:** delete the local `_reconcile_once` and `_reconcile_forever`
     (`:81-104`). In `_lifespan`, build the `ReconcilerState`, define small
     `on_result`/`on_error` closures that populate it (preserving the
     class-name-only masking), and call the shared functions:
     ```python
     from counselle_db.reconcile import reconcile_field_index, reconcile_once, reconcile_forever
     ...
     reconciler = ReconcilerState()
     def _on_result(result: dict[str, int]) -> None:
         reconciler.last_run = datetime.now(UTC).isoformat()
         reconciler.last_result = result
         reconciler.last_error = None
     def _on_error(exc: Exception) -> None:
         reconciler.last_run = datetime.now(UTC).isoformat()
         reconciler.last_result = None
         reconciler.last_error = type(exc).__name__   # never leak DSNs/hosts
         logger.exception("field_index reconcile failed — keyword fallback serves", error=repr(exc))
     await reconcile_once(runtime.app_pool, _on_result, _on_error)
     reconcile_task = asyncio.create_task(
         reconcile_forever(runtime.app_pool, settings.reconcile_interval_minutes, _on_result, _on_error),
         name="field-index-reconciler",
     )
     ```
     (Note: `_on_result` must also stamp `last_run` since the old `_reconcile_once`
     stamped it unconditionally at the top — preserve that. Verify against the
     health-surface test.)

  3. **`counselle_db/server.py`:** delete `_reconcile_forever` (`:42-49`), the
     startup reconcile pass (`:64-67`), the `reconcile_task` create/cancel
     (`:68-76`), and the now-unused `reconcile_field_index` import (`:28`). The
     child's lifespan keeps loading the catalog and yielding `AppState`; it no
     longer touches `field_index`. Update the `_lifespan` docstring to drop the
     "reconcile field_index" claim. (`asyncio`/`contextlib` imports: keep only if
     still used elsewhere in the file; remove if not — ruff will flag.)

  4. **`api/main.py` docstring (`:14-18`):** drop the now-false note that the MCP
     child's reconciler "only covers the child process" — the child no longer
     reconciles. State plainly: the API process is the single reconcile owner;
     the MCP child reads the index.

  5. **`api/routes/system.py`:** unchanged — `admin_reconcile` calls
     `reconcile_field_index(runtime.app_pool)` directly (a manual one-shot is fine;
     it is the same single owner's pool).

- **Tests to add/keep-green** (`tests/counselle_db/test_reconcile.py` +
  `tests/api/`):
  - `reconcile_once` invokes `on_result` with the delta dict on success and
    `on_error` with the exception on failure, and never raises.
  - `reconcile_forever` sleeps then reconciles (one iteration via monkeypatched
    sleep that cancels after the first pass).
  - The MCP child lifespan no longer schedules a reconcile task — assert
    `server._reconcile_forever` no longer exists (the symbol is gone).
  - Keep green: the `/v1/health` reconciler-surface test (the `ReconcilerState`
    fields still populate as before — last_run/last_result/last_error).

- **Acceptance criteria:**
  - [ ] `reconcile_once` + `reconcile_forever` live ONLY in
        `counselle_db/reconcile.py`.
  - [ ] `api/main.py` has no local `_reconcile_forever`/`_reconcile_once`; it
        calls the shared ones with health callbacks; class-name-only masking
        preserved.
  - [ ] `counselle_db/server.py` no longer imports `reconcile_field_index`, no
        longer runs a startup pass or interval task.
  - [ ] The `main.py` docstring no longer claims the child reconciles.
  - [ ] The advisory-lock multi-replica seam is documented in `reconcile.py`.
  - [ ] Health surface + reconcile tests green.

---

### M1 — Guard `Catalog._reload` with a lock + double-checked `loaded_at`  [MEDIUM]

- **Files:** `counselle_db/catalog.py:140-150` (`__init__`), `:179-222`
  (`maybe_refresh`/`_reload`).

- **Problem:** `maybe_refresh` checks `self.loaded_at` then `await self._reload()`
  with no lock. The in-process catalog is shared by every `app/` service call
  (`build_runtime` loads one). N concurrent turns that all observe a stale
  `loaded_at` each launch a full `_reload` (4 queries incl. ~2.7k school rows) —
  a thundering herd. The instance-state swap (`:215-222`) is multiple assignments,
  not atomic; a reader between assignments can see new `fields_by_key` with old
  `scorecard_filename` (vintage derived from a stale filename against new fields —
  an honesty-core inconsistency, low probability).

- **Fix (EXACT):** Add an `asyncio.Lock` and double-check `loaded_at` inside it.
  Only the first waiter reloads; the rest see the fresh `loaded_at` and return.

  `__init__`: add `self._reload_lock = asyncio.Lock()`.

  `maybe_refresh`:
  ```python
  async def maybe_refresh(self) -> None:
      if datetime.now(UTC) - self.loaded_at < _REFRESH_INTERVAL:
          return
      async with self._reload_lock:
          # Double-check: a concurrent caller may have reloaded while we waited.
          if datetime.now(UTC) - self.loaded_at < _REFRESH_INTERVAL:
              return
          try:
              await self._reload()
          except Exception:
              logger.warning("catalog refresh failed — serving stale catalog", exc_info=True)
              self.loaded_at = datetime.now(UTC) - (_REFRESH_INTERVAL - timedelta(minutes=10))
  ```
  The local-build-then-swap in `_reload` (`:200-222`) already builds into locals
  first; doing the swap under the held lock makes it effectively atomic for
  cooperative scheduling (the `self.* = …` assignments have no `await` between
  them — they were already atomic; the lock just serializes the *reload itself*).
  Do not add a lock around `load()` (the initial load is single-shot at boot).

- **Tests to add/keep-green** (`tests/counselle_db/test_catalog_refresh.py`):
  - Concurrent `maybe_refresh` (gather N) triggers exactly ONE `_reload` (count
    calls via a monkeypatched `_reload` that awaits an event — prove only one
    runs and the rest short-circuit on the double-check).
  - The stale-on-failure backoff still applies (existing test stays green).

- **Acceptance criteria:**
  - [ ] `_reload_lock` added; `maybe_refresh` double-checks under the lock.
  - [ ] Concurrent refresh triggers one reload (test).
  - [ ] Existing catalog-refresh tests green.

---

### M3 — Decompose `run_turn`; make the `# noqa: C901` honest or removable  [MEDIUM]

- **Files:** `app/run_turn.py:178-413`.

- **Problem:** `run_turn` is a 235-line function carrying `# noqa: C901` whose
  justification ("the one stream switch; splitting hides the protocol") only
  covers the stream loop (`:271-311`). The function also does session-ensure,
  parked-detection, offset math, the resume-vs-new branch, and three record
  writes — exactly the logic H1/H2 centralize. The size makes the
  honesty-critical paths hard to unit-test.

- **Fix (EXACT):** Extract `_prepare_turn_input` (the parked detection + offset +
  graph_input assembly), route persistence through H1's `build_terminal_update`,
  and keep the stream switch inline. After extraction the function should drop
  under the complexity threshold so the `# noqa` can be removed; if it is still
  marginally over because of the inline stream switch, keep the `noqa` but the
  justification is now honest (only the switch remains).

  ```python
  @dataclass
  class _TurnInput:
      graph_input: Any
      turn_ids: dict[str, Any]
      messages_offset: int | None
      record_user_text: str | None
      parked: dict[str, Any] | None     # the parked record, or None
      message_id: str

  async def _prepare_turn_input(
      graph: Any, deps: GraphDeps, settings: Any, *,
      session_id: str, user_text: str, source_config: SourceConfig | None,
      snapshot: Any, prior_records: list[dict[str, Any]],
      message_id: str, user_message_id: str, trace_id: str,
  ) -> _TurnInput:
      """Build the graph input for this turn: resume (parked) vs new.

      Parked detection uses the record (parked_record); the resume reuses the
      parked message_id and carries its messages_offset forward; a new turn
      appends the serialized user ModelRequest. The pre-run resume aupdate_state
      lives here too — its failure is the BC-11 path (the caller turns a raised
      exception into an ev_error + return, leaving the thread parked)."""
      ...
  ```
  Keep the resume pre-write *inside* `_prepare_turn_input` but let it RAISE on
  failure (do not swallow); `run_turn` catches it in a dedicated `except` that
  yields `ev_error` and returns WITHOUT writing a record (BC-11, H2(c)).
  Concretely, structure `run_turn` so the prepare call is in its own try:
  ```python
  try:
      turn_input = await _prepare_turn_input(...)
  except _ResumePrewriteError:    # raised only by the resume aupdate_state
      yield ev_error(_USER_SAFE_ERROR, trace_id)
      return
  ```
  Use a small private sentinel exception (`_ResumePrewriteError`) so a resume
  pre-write failure is distinguishable from any other prepare failure (a prepare
  failure that is NOT the resume write — e.g. `_ensure_session` — should still go
  to the normal error handler that writes the failure record). Be precise: only
  the resume `aupdate_state` failure must skip the record write; everything else
  keeps today's error-record behavior.

  Route the parked-record write and the error-record write through
  `build_terminal_update` (H1). Keep the stream loop (`astream` switch) inline.

- **Tests to add/keep-green:**
  - `_prepare_turn_input` returns a resume `Command(resume=…)` input when parked,
    a new-turn dict input when not (unit, with a fake graph).
  - The BC-11 test from H2 (resume pre-write failure leaves the thread parked) —
    now exercised through `_prepare_turn_input`'s raise.
  - Non-resume prepare failures (e.g. `_ensure_session` raising) still write the
    error record (keep the existing `test_run_turn` error-path tests green).
  - Keep ALL of `tests/app/test_run_turn.py` green unedited.

- **Acceptance criteria:**
  - [ ] `_prepare_turn_input` extracted; `run_turn`'s body is materially shorter.
  - [ ] The stream switch stays inline; the `# noqa: C901` is removed OR its
        comment now accurately describes only the remaining switch.
  - [ ] Persistence routes through `build_terminal_update`.
  - [ ] Resume-pre-write failure skips the record write; other failures don't.
  - [ ] `test_run_turn` green unedited.

---

### M4 — One school-SELECT column source  [MEDIUM]

- **Files:** `counselle_db/service.py:77`, `:78-81`, `:87-94`, `:409-413`.

- **Problem:** `SELECT unitid, name, city, state, control, level FROM schools`
  appears three times (one buried inline in `compare_schools`), and the fuzzy
  search repeats the same column prefix. `SchoolBasics` is built from exactly
  these columns (`_school_basics`, `:216-217`); a model field change requires
  editing several SQL strings in lockstep.

- **Fix (EXACT):** One column constant + a tiny select helper.
  ```python
  #: The SchoolBasics column list — the single source for every schools SELECT.
  #: Must match SchoolBasics.model_fields (the _school_basics builder).
  _SCHOOL_COLUMNS = "unitid, name, city, state, control, level"
  _SCHOOL_SELECT = f"SELECT {_SCHOOL_COLUMNS} FROM schools"
  ```
  Replace:
  - `_SCHOOL_SQL = f"{_SCHOOL_SELECT} WHERE unitid = $1"`
  - `_SEARCH_SQL = f"{_SCHOOL_SELECT} WHERE name ILIKE '%' || $1 || '%' ORDER BY name LIMIT 10"`
  - `_FUZZY_SEARCH_SQL`: use `f"SELECT {_SCHOOL_COLUMNS}, GREATEST(...) AS score FROM schools ..."`.
  - `compare_schools` (`:409-413`): `f"{_SCHOOL_SELECT} WHERE unitid = ANY($1::int[])"`.

  Optionally add a one-line assertion or comment tying `_SCHOOL_COLUMNS` to
  `SchoolBasics.model_fields` (the builder already iterates those fields).

- **Tests to add/keep-green:** existing `service.py` tests (resolve/search/compare)
  cover the SQL paths — they must stay green (behavior identical). No new test
  required beyond confirming the green suite; optionally a test asserting
  `_SCHOOL_COLUMNS` covers every `SchoolBasics.model_fields` name.

- **Acceptance criteria:**
  - [ ] `SELECT unitid, name, city, state, control, level FROM schools` appears
        zero times literally; all four sites derive from `_SCHOOL_SELECT`/
        `_SCHOOL_COLUMNS` (grep).
  - [ ] service tests green.

---

### M5 — Delete the `api/usage.py` re-export shim  [MEDIUM]

- **Files:** `api/usage.py` (delete); `tests/api/test_usage.py:10,165,167,180,
  182,192,194` (repoint).

- **Problem:** `api/usage.py` is a pure re-export shim of `app/usage.py` "for
  existing importers". The only repo importer is `tests/api/test_usage.py`. Two
  import paths to the same symbols invite confusion about which is canonical.

- **Fix (EXACT):**
  - `tests/api/test_usage.py:10`: `from app.usage import enrich_usage_event,
    estimate_cost, log_turn_complete`.
  - The `caplog.at_level(..., logger="api.usage")` / `logging.getLogger("api.usage")`
    references (`:165-194`): the log lines are emitted by `log_turn_complete(logger, …)`
    where `logger` is passed by the caller, so the test passes its OWN logger.
    Inspect how the test constructs the logger — if it captures under the name
    `"api.usage"`, change it to `"app.usage"` (or whatever logger the test passes
    into `log_turn_complete`). Make the assertions match the real emitting logger.
    Confirm by running the test after the edit.
  - Delete `api/usage.py`.
  - Grep the whole repo (excluding `.worktrees/`) for `api.usage` /
    `from api import usage` to confirm nothing else imports it.

- **Tests to add/keep-green:** `tests/api/test_usage.py` green after repoint.

- **Acceptance criteria:**
  - [ ] `api/usage.py` deleted.
  - [ ] No `api.usage` import anywhere (grep, excluding `.worktrees/`).
  - [ ] `tests/api/test_usage.py` green.

---

### M7 — `TurnStatus` defined in terms of the wire `DoneStatus`; drop the ignores  [MEDIUM]

- **Files:** `domain/events.py:25` (`DoneStatus`); `app/records.py:34`
  (`TurnStatus`); `app/turns.py:568` (`# type: ignore[arg-type]`).

- **Problem:** Two near-identical status vocabularies: `DoneStatus = Literal[
  "complete", "awaiting_input", "cancelled"]` (wire) and `TurnStatus = Literal[
  "complete", "awaiting_input", "cancelled", "error"]` (record, adds `error`).
  Callers convert with `# type: ignore[arg-type]` (`turns.py:568`). The
  relationship is real but implicit.

- **Fix (EXACT):** Make the record status set explicitly the wire set plus
  `error`:
  ```python
  # app/records.py
  from domain.events import DoneStatus
  TurnStatus = DoneStatus | Literal["error"]
  ```
  Then the literals callers pass (`"cancelled"`, `"error"`, `"awaiting_input"`,
  `"complete"`) are all members of `TurnStatus`, so:
  - `app/turns.py:568`: drop `# type: ignore[arg-type]`. With H1's
    `build_terminal_update` taking `status: TurnStatus` and `_persist_partial`
    receiving `status: str`, narrow with `cast("TurnStatus", status)` at the
    registry boundary (the registry's `_persist_partial_guarded` signature uses
    `status: str` for `"cancelled"`/`"error"` — either tighten that signature to
    `TurnStatus` or `cast`; prefer tightening the signature so no cast is needed).
  - Verify no other `# type: ignore` referencing the status types remains (grep
    `ignore` near `status` in `app/`).

- **Tests to add/keep-green:** type-only change; `mypy .` must be green with no
  status-related ignore. The runtime behavior is identical — full suite green.

- **Acceptance criteria:**
  - [ ] `TurnStatus = DoneStatus | Literal["error"]` in `records.py`.
  - [ ] `app/turns.py:568`'s `# type: ignore[arg-type]` removed (cast or tightened
        signature instead).
  - [ ] `mypy .` green; no status-type ignore remains.

---

### L4 — Decouple the config caches  [LOW]

- **Files:** `config/settings.py:210-239`.

- **Problem:** `get_settings` / `load_prompt` / `load_yaml_asset` share coupled
  `lru_cache`s with a manual "clear all three" rule encoded as a comment
  (`:225-226`). `load_yaml_asset`/`load_prompt` key on `name` but read
  `get_settings().assets_dir`, so a settings change with a different `assets_dir`
  returns stale assets unless all three caches are cleared together. Bites tests
  today; an implicit invariant that can break silently.

- **Fix (EXACT) — pick ONE (prefer the helper, it is the smaller change and
  matches how the asset loaders work today):**

  Option A — one `reset_config_caches()` used everywhere:
  ```python
  def reset_config_caches() -> None:
      """Clear all three coupled config caches together (the assets caches key on
      `name` only but read get_settings().assets_dir — clearing one without the
      others would serve stale assets; audit L4)."""
      get_settings.cache_clear()
      load_prompt.cache_clear()
      load_yaml_asset.cache_clear()
  ```
  Then grep for ad-hoc `.cache_clear()` on these three (in tests/conftest/fixtures)
  and replace each cluster with `reset_config_caches()`. Keep the NOTE comment but
  point it at the helper.

  Option B — key the asset caches on `(assets_dir, name)` so they self-invalidate:
  ```python
  @lru_cache
  def _load_prompt(assets_dir: Path, name: str) -> str:
      return (assets_dir / "prompts" / f"{name}.md").read_text(encoding="utf-8")
  def load_prompt(name: str) -> str:
      return _load_prompt(get_settings().assets_dir, name)
  ```
  (and likewise for `load_yaml_asset`). This removes the coupling entirely but
  changes the public callables' cache identity — verify no test relies on
  `load_prompt.cache_clear()` directly (if it does, Option A is safer).

  Implementer: choose Option A unless a test depends on per-callable cache_clear
  in a way Option A breaks; document the choice in the PR.

- **Tests to add/keep-green:** a test that changing `assets_dir` (via the settings
  fixture) and calling `reset_config_caches()` (Option A) — or just re-calling
  (Option B) — returns the NEW asset, not the stale one. Existing config tests
  green.

- **Acceptance criteria:**
  - [ ] Either `reset_config_caches()` exists and is used at every clear site, OR
        asset caches key on `(assets_dir, name)`.
  - [ ] The stale-asset footgun is gone (test proves fresh assets after an
        assets_dir change).
  - [ ] Config tests green.

---

### L5 — One `_kind_for(tool_name)` in `EmissionRouter`/`StepMapper`  [LOW]

- **Files:** `app/steps.py:129`, `:159`, `:239`.

- **Problem:** The "unknown tool ⇒ `db_tool`" default is expressed three times:
  `(self._tools.get(tool_name) or self._default).get("kind", "db_tool")` at
  `map_call` (`:129`), `detail_for` (`:159`), and `sources_for` (`:239`). A change
  to the default needs all three.

- **Fix (EXACT):** One private method on `StepMapper` (the three call sites are all
  on `StepMapper`):
  ```python
  def _kind_for(self, tool_name: str) -> StepKind:
      """The step kind for a tool: the labels-asset kind, else db_tool default."""
      row = self._tools.get(tool_name) or self._default
      return row.get("kind", "db_tool")
  ```
  - `map_call` (`:129`): note it currently uses `row.get("kind", "db_tool")` where
    `row` carries an `_unknown` marker — keep `map_call`'s own `row` lookup for the
    label, but use `self._kind_for(tool_name)` for the kind to keep one source. Be
    careful: `map_call`'s `row` is `{**self._default, "_unknown": True}` on
    unknown, whose `.get("kind", "db_tool")` already resolves to `self._default`'s
    kind or `db_tool` — `_kind_for` gives the identical result. Verify equivalence.
  - `detail_for` (`:159`): `kind = self._kind_for(tool_name)`.
  - `sources_for` (`:239`): `kind = self._kind_for(tool_name)`.

- **Tests to add/keep-green:** existing `tests/app/test_steps.py` /
  `test_step_sources.py` cover unknown-tool default and per-kind routing — keep
  green. Optionally a direct `_kind_for` unit test (known tool → its kind, unknown
  → `db_tool`).

- **Acceptance criteria:**
  - [ ] `_kind_for` exists; the three sites call it; the `("kind", "db_tool")`
        default literal appears once.
  - [ ] step tests green.

---

## Cross-phase notes (Phase 1 already fixed the races in these functions — build on that)

Phase 3 refactors the SAME functions Phase 1 hardened. Preserve every Phase-1 fix
while moving code:

- **BC-01 / BC-05 (ring buffer):** Phase 1 made the buffer byte-bounded and added
  the append-after-close guard. H1's `build_terminal_update` does NO buffer work
  (it builds the `aupdate_state` payload only) — leave the buffer code in
  `turns.py` exactly as Phase 1 left it. Do not touch `_RingBuffer`.
- **BC-03 / BC-04 (concurrent cancel / terminal single-flight):** Phase 1
  serialized the terminal-append decision (per-turn lock / `cancel_requested`
  synchronous set). H1 moves only the *record-building* logic out of
  `_cancel_active`/`_handle_timeout`; the *terminal-event append + finalize* stay
  in `turns.py` under Phase 1's locking. `_persist_partial` is still called from
  `_persist_partial_guarded` (Phase 1's retry/timeout wrapper) — keep that wrapper
  and its `asyncio.timeout` (BC-08); `build_terminal_update` only replaces the body
  of `_persist_partial`, not its guard.
- **BC-06 (cross-turn Last-Event-ID):** lives in `_follow`/`attach`/the route —
  H2/H3 don't touch it. Leave it.
- **BC-11 (resume-failure orphan):** H2(c) is the architectural fix; if Phase 1
  already added a guard here, H2(c) supersedes it with the cleaner "leave the
  thread parked, write no record" approach via `_prepare_turn_input`'s raise.
  Reconcile: there must be exactly one BC-11 fix; the H2(c) version wins.
- **BC-12 (pre-start route writes):** Phase 1 moved the title/source-config writes
  to after a successful `start()`. H3 changes only the deletion import path in the
  same route file — do not reintroduce the pre-start writes.
- **BC-15 (shutdown drain mislabel):** Phase 1 gave `aclose` a distinct
  `status="error"` drain path. That path now also goes through
  `build_terminal_update` (status `"error"`) — confirm the drain still produces an
  `error` record, not `cancelled`, after the H1 extraction.
- **M7 + Phase 1:** if Phase 1 added any new `status` literal handling, ensure it
  is a member of the new `TurnStatus = DoneStatus | Literal["error"]`.

If a Phase-1 change conflicts with a Phase-3 extraction, the *behavior* Phase 1
established wins (it fixed a real bug); re-express it through the new module rather
than reverting it. Flag any such reconciliation in the PR.

---

## Phase completion checklist

- [ ] **H1/BC-09:** `app/turn_persistence.py` owns the empty-partial rule and the
      record build; all four terminal paths route through it; the three parallel
      implementations and the "KEEP IN SYNC" comment are deleted; equivalence
      tests prove identical record shape per status.
- [ ] **H2/BC-11/BC-14:** `is_parked`/`parked_record`/`resolve_offset`/`AGENT_NODE`
      are single-owned; `graph.py` + `turns.py` share `AGENT_NODE`; the
      OR-on-interrupt parked fallback is removed (record is source of truth); a
      failed resume pre-write leaves the thread parked (no orphaned clarify).
- [ ] **H3:** `cancel_and_drop_threads` is public in `app/chat_deletion.py`, takes
      registry + checkpointer explicitly; no cross-route private import remains.
- [ ] **H4:** one reconcile owner (the API process); `reconcile_once`/
      `reconcile_forever` hoisted into `counselle_db/reconcile.py`; the MCP child's
      reconciler removed; the advisory-lock seam documented.
- [ ] **M1:** `Catalog._reload` guarded by a lock with a double-checked
      `loaded_at`; concurrent refresh reloads once.
- [ ] **M3:** `_prepare_turn_input` extracted; persistence via H1; the `# noqa:
      C901` removed or honestly scoped.
- [ ] **M4:** one `_SCHOOL_COLUMNS`/`_SCHOOL_SELECT`; the literal column SELECT
      appears nowhere else.
- [ ] **M5:** `api/usage.py` deleted; importers repointed to `app.usage`.
- [ ] **M7:** `TurnStatus = DoneStatus | Literal["error"]`; the status
      `# type: ignore` removed.
- [ ] **L4:** config caches decoupled (`reset_config_caches()` or
      `(assets_dir, name)` keys).
- [ ] **L5:** one `_kind_for(tool_name)`.
- [ ] **Leave-alones respected:** M2, M6, L6/DS-07 untouched.
- [ ] **Gate green:** `ruff`, `mypy`, full routine pytest.
- [ ] **Equivalence proven:** `tests/app/test_turns.py`,
      `tests/app/test_run_turn.py`, `tests/app/test_records.py` pass WITHOUT edits.
- [ ] **Cross-phase:** every Phase-1 fix in these functions preserved
      (ring buffer, cancel single-flight, persist timeout, Last-Event-ID,
      pre-start writes, shutdown-drain error label).
