# Phase 1 — Turn-Lifecycle Correctness & Safety

> Execution: follow the per-phase loop in `plans/audit/REMEDIATION-PLAN.md` §2
> (dispatch Opus implementers → run the gate → ≥3 non-leading Sonnet reviewers →
> Opus fixers → re-review until unanimous SHIP → commit). This file is the
> authoritative spec for Phase 1. Implement EVERYTHING below; miss nothing —
> every finding, every before/after snippet, every test, every acceptance box.
>
> This is honesty-critical lifecycle code (the turn stream is the student-facing
> honesty surface — "exactly one terminal event, nothing after it, never a
> silent skip"). Every fix gets a regression test. Where a snippet here diverges
> from the real file (line numbers WILL have drifted), trust the real code and
> adapt the snippet's intent.

---

## Scope & files touched

**Implementation:**
- `app/turns.py` — the turn registry, ring buffer, `_drive`, cancel/timeout/
  finalize, `_follow`, `_persist_partial*`, `aclose`. (Owns BC-01..BC-08,
  BC-10, BC-15..BC-20.)
- `app/records.py` — `derive_receipt` (BC-20 only).
- `api/routes/sessions.py` — `post_message` ordering (BC-12, BC-21),
  `_parse_last_event_id` doc (BC-16), `stream_session` (BC-06 wire-through).
- `config/settings.py` — add `stream_buffer_bytes` (BC-01), document the
  `stream_buffer_size` interplay.
- `api/sse.py` — comment only (BC-17, no behavior change).

**Tests (new / extended):**
- `tests/app/test_turns.py` — the home for every lifecycle regression test in
  this phase (it already has the rig + helpers: `Rig`, `_registry`,
  `_gated_model`, `Collector`, `_eventually`, `_drain`, `_state_values`,
  `_prose`, `FakeSettings`). Add the new tests here.
- `tests/app/test_records.py` — the BC-20 `derive_receipt` test.

**Leave-alone (do NOT "fix" — recorded so reviewers don't flag a miss):**
- 01-M2 double catalog load, 01-M6 per-turn agent rebuild (LangGraph replay
  pattern — `app/agent_node.py` module docstring explains it), 01-L6 / DS-07
  regex SQL guard. None are in this phase's scope.
- `protocol_version` stays a constant (07 LA list).
- BC-07 is "keep cheap + document invariant", NOT "move enrichment off the
  path" — do not restructure `_observe` into a lazy/async enricher (YAGNI; the
  CLAUDE.md value×ease rule says don't build machinery for a problem that isn't
  here yet). The fix is a guard-comment + a test that pins O(1).

**Cross-phase (NOT this phase — see "Cross-phase notes" at the end):**
- BC-09 (`_persist_partial` ↔ `_write_failure_record` dedup) → Phase 3.
- BC-11 (resume-failure clarify orphan) → Phase 3.
- BC-13 (receipt `result_count` omission) → Phase 2.
- BC-14 (parked OR-detection desync) → Phase 3.

---

## Gate commands (for this phase)

```bash
# Backend (this phase is backend-only)
uv run ruff check .
uv run mypy .
uv run pytest -m "not live_llm and not live_search" tests/app/test_turns.py tests/app/test_records.py
# Then the full routine suite to prove no lifecycle regression elsewhere:
uv run pytest -m "not live_llm and not live_search"
```

All four must be green before review. `mypy` is made green by Phase 0; if it is
red on entry for unrelated reasons, flag it but do not let it block Phase 1's
own diff being clean.

---

## Findings & fixes

Order: CRITICAL → HIGH → MEDIUM → LOW.

---

### BC-01 — Unbounded `_RingBuffer`: a single turn (or 50 of them) can OOM the process  [CRITICAL]

- **Files:** `app/turns.py` (`_RingBuffer`, `_Turn`, `TurnRegistry.__init__`,
  `start`, `_drive`, `_finalize`), `config/settings.py`.

- **Problem:** Each in-flight turn allocates a `_RingBuffer` capped at
  `stream_buffer_size` **events** (default `20_000`). With
  `max_concurrent_turns` (default `50`) live turns, that is up to
  `50 × 20_000` fully-materialized `Event` objects — and each `delta`/`step`
  event can carry a non-trivial payload (prose chunks, thinking summaries,
  step receipts embedding SQL/search results/school lists). The ceiling is
  per-turn and counted in events, with **no global byte budget**. A burst of
  long-running turns (each legitimately allowed by single-flight + the 50-cap)
  can drive the heap to OOM with no adversary — just long answers. The buffer
  is intentionally sized so a normal turn never evicts a delta (the honesty
  goal: a consumer never silently skips prose), but the cost of that policy is
  unbounded memory.

  The right fix is a **shared global byte budget** across all live turns, with
  per-turn eviction driven by bytes, while preserving the existing honest
  fell-off-head behavior (`_follow` already terminates a fallen-behind consumer
  with an `error` event — BC-05/BC-06 harden that path). The event-count cap
  stays as a secondary ceiling.

- **Fix:**

  **(a) Add a byte budget setting.** In `config/settings.py`, in the
  `# --- Turn registry ...` block, alongside `stream_buffer_size`:

  *Before:*
  ```python
      # Ring-buffer capacity in events, sized to a full worst-case turn so
      # overflow is effectively unreachable (a consumer that still falls off the
      # head is terminated with an `error` event — never silently skipped).
      stream_buffer_size: int = 20_000
  ```
  *After:*
  ```python
      # Ring-buffer capacity in events, sized to a full worst-case turn so
      # overflow is effectively unreachable (a consumer that still falls off the
      # head is terminated with an `error` event — never silently skipped).
      stream_buffer_size: int = 20_000
      # Process-wide byte budget shared across EVERY live turn's ring buffer.
      # The real OOM guard: stream_buffer_size bounds one turn's event COUNT,
      # this bounds the TOTAL bytes held by all in-flight buffers. When a new
      # event would push the global total over budget, the oldest events across
      # the appending buffer are evicted (head-only) — a consumer that then
      # falls off the head is terminated honestly with an `error` (BC-05/06).
      # 256 MiB default ≈ comfortably below a 512 MiB–1 GiB container; tune per
      # deploy. The accumulator lives on the TurnRegistry and is decremented on
      # eviction and at finalize.
      stream_buffer_bytes: int = 256 * 1024 * 1024
  ```

  **(b) Give the registry a shared accumulator.** In `TurnRegistry.__init__`,
  after `self._turns: dict[str, _Turn] = {}`:

  *Before:*
  ```python
          self._turns: dict[str, _Turn] = {}
  ```
  *After:*
  ```python
          self._turns: dict[str, _Turn] = {}
          #: Process-wide byte budget shared across every live ring buffer
          #: (BC-01). Incremented on append, decremented on eviction and at
          #: finalize. A new event that would exceed the budget triggers
          #: head-eviction on the appending buffer (oldest-first) until it fits;
          #: a consumer that falls off the head is terminated honestly (BC-05).
          self._buffer_bytes_budget: int = getattr(
              settings, "stream_buffer_bytes", 256 * 1024 * 1024
          )
          self._buffer_bytes_used: int = 0
  ```

  **(c) Make `_RingBuffer` byte-aware and budget-aware.** Replace the buffer's
  `__init__`/`append` with a version that (1) tracks each event's byte size,
  (2) calls back to the registry to charge/refund the shared accumulator, and
  (3) evicts when EITHER the per-turn event cap OR the global byte budget is
  exceeded. Pass the registry's charge/evict callbacks into the buffer at
  construction so the buffer stays self-contained but the budget is shared.

  *Before:*
  ```python
  class _RingBuffer:
      """Append-only event log with head eviction; followers read by seq index.

      ``seq`` is the buffer index (starting at 0) — exactly the SSE ``id:``
      value, identical for every consumer. Eviction only ever drops the head
      (oldest); a follower that needs an evicted seq has fallen behind.
      """

      def __init__(self, maxsize: int) -> None:
          self._maxsize = max(1, maxsize)
          self._events: list[Event] = []
          self.base = 0  # seq of self._events[0]
          self.closed = False
          self._flag = asyncio.Event()

      @property
      def next_seq(self) -> int:
          return self.base + len(self._events)

      def get(self, seq: int) -> Event:
          return self._events[seq - self.base]

      def append(self, event: Event) -> None:
          self._events.append(event)
          if len(self._events) > self._maxsize:
              del self._events[0]
              self.base += 1
          self._notify()

      def close(self) -> None:
          self.closed = True
          self._notify()

      def _notify(self) -> None:
          flag, self._flag = self._flag, asyncio.Event()
          flag.set()

      @property
      def flag(self) -> asyncio.Event:
          """The current wakeup flag — capture BEFORE checking availability."""
          return self._flag
  ```
  *After:*
  ```python
  def _event_nbytes(event: Event) -> int:
      """Approximate heap cost of one buffered event (BC-01 byte accounting).

      The compact JSON length is a cheap, deterministic, monotone proxy for the
      event's footprint — exact byte counting of nested dicts is not worth it
      (KISS); we only need a stable size to drive the shared budget. A constant
      per-object overhead covers the Event wrapper + list slot.
      """
      try:
          return len(json.dumps(event.data, separators=(",", ":"))) + _EVENT_OVERHEAD_BYTES
      except (TypeError, ValueError):
          # An unserializable payload should never reach here, but never let
          # sizing crash the producer — charge a flat fallback.
          return _EVENT_OVERHEAD_BYTES


  class _RingBuffer:
      """Append-only event log with head eviction; followers read by seq index.

      ``seq`` is the buffer index (starting at 0) — exactly the SSE ``id:``
      value, identical for every consumer. Eviction only ever drops the head
      (oldest); a follower that needs an evicted seq has fallen behind.

      Eviction fires when EITHER the per-turn event cap (``maxsize``) OR the
      process-wide byte budget (BC-01, enforced via ``on_charge``) is exceeded.
      ``on_charge(delta)`` returns the budget's remaining headroom AFTER the
      charge: a negative return means over budget → evict heads until it clears.
      """

      def __init__(
          self,
          maxsize: int,
          *,
          on_charge: Callable[[int], int],
          on_refund: Callable[[int], None],
      ) -> None:
          self._maxsize = max(1, maxsize)
          self._events: list[Event] = []
          self._sizes: list[int] = []  # parallel to _events: each event's nbytes
          self.base = 0  # seq of self._events[0]
          self.closed = False
          self._flag = asyncio.Event()
          self._on_charge = on_charge
          self._on_refund = on_refund

      @property
      def next_seq(self) -> int:
          return self.base + len(self._events)

      def get(self, seq: int) -> Event:
          return self._events[seq - self.base]

      def append(self, event: Event) -> None:
          if self.closed:
              # Append-after-close is a logic bug (BC-05): a late terminal/
              # enrichment must never land past the terminal a consumer already
              # saw. Drop it loudly rather than corrupt the protocol.
              logger.warning("append after close ignored (type=%s)", event.type)
              return
          nbytes = _event_nbytes(event)
          self._events.append(event)
          self._sizes.append(nbytes)
          headroom = self._on_charge(nbytes)
          # Evict heads while over the event cap OR over the global byte budget,
          # but never evict the only event (an empty buffer can't be read).
          while len(self._events) > 1 and (len(self._events) > self._maxsize or headroom < 0):
              evicted = self._sizes.pop(0)
              del self._events[0]
              self.base += 1
              self._on_refund(evicted)
              headroom += evicted
          self._notify()

      def close(self) -> None:
          self.closed = True
          self._notify()

      def drop_all(self) -> None:
          """Refund every still-held event's bytes to the shared budget — called
          at finalize so an evicted-at-terminal buffer never leaks budget."""
          for size in self._sizes:
              self._on_refund(size)
          self._sizes.clear()

      def _notify(self) -> None:
          flag, self._flag = self._flag, asyncio.Event()
          flag.set()

      @property
      def flag(self) -> asyncio.Event:
          """The current wakeup flag — capture BEFORE checking availability."""
          return self._flag
  ```

  Add the module constant near the top of `app/turns.py` (after the existing
  `_USER_SAFE_*` constants):
  ```python
  #: Flat per-event overhead added to the JSON byte estimate (BC-01) — covers
  #: the Event wrapper, the list slot, and dict/list object headers.
  _EVENT_OVERHEAD_BYTES = 256
  ```
  **Add `import json` to the top-of-file import block in `app/turns.py` (not
  currently imported).** Verified against the real file: the stdlib import block
  is `import asyncio` / `import logging` / `import time` — `json` is absent, so
  `_event_nbytes`'s `json.dumps(...)` would `NameError` without this. Add
  `import json` alphabetically (after `import asyncio`, before `import logging`).
  `Callable` is already imported from `collections.abc`.

  **(d) Wire the registry's charge/refund into buffer construction.** In
  `start`, replace the buffer construction:

  *Before:*
  ```python
          buffer = _RingBuffer(getattr(self._settings, "stream_buffer_size", 20_000))
  ```
  *After:*
  ```python
          buffer = _RingBuffer(
              getattr(self._settings, "stream_buffer_size", 20_000),
              on_charge=self._charge_bytes,
              on_refund=self._refund_bytes,
          )
  ```

  Add the two helpers to `TurnRegistry` (place them near `is_generating`, in the
  synchronous-helpers cluster — see BC-10):
  ```python
      # -- the shared byte budget (BC-01) -------------------------------------

      def _charge_bytes(self, nbytes: int) -> int:
          """Charge ``nbytes`` to the global budget; return remaining headroom
          AFTER the charge (negative ⇒ over budget ⇒ the buffer evicts)."""
          self._buffer_bytes_used += nbytes
          return self._buffer_bytes_budget - self._buffer_bytes_used

      def _refund_bytes(self, nbytes: int) -> None:
          """Return ``nbytes`` to the global budget on eviction/finalize."""
          self._buffer_bytes_used -= nbytes
          if self._buffer_bytes_used < 0:  # defensive: never let it go negative
              self._buffer_bytes_used = 0
  ```

  **(e) Refund at finalize.** In `_finalize`, after `turn.buffer.close()`:

  *Before:*
  ```python
          turn.finalized = True
          turn.buffer.close()
          if self._turns.get(turn.session_id) is turn:
              del self._turns[turn.session_id]
  ```
  *After:*
  ```python
          turn.finalized = True
          turn.buffer.close()
          turn.buffer.drop_all()  # BC-01: return this turn's bytes to the budget
          if self._turns.get(turn.session_id) is turn:
              del self._turns[turn.session_id]
  ```

  **Concurrency note (no new awaits):** `_charge_bytes`/`_refund_bytes`/
  `_event_nbytes`/`append`/`drop_all` are all synchronous and run on the single
  asyncio thread; the accumulator is mutated only between awaits, so it stays
  consistent without a lock (same regime as `_turns` — BC-10). Keep them
  await-free.

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_byte_budget_evicts_oldest_when_over_budget` — set
     `settings.stream_buffer_bytes` very small (e.g. 2_000) and
     `stream_buffer_size = 20_000` (so the EVENT cap never fires), run a
     `_gated_model` that streams several large chunks past the byte budget while
     gated; assert `turn.buffer.base > 0` (head evicted by bytes, not count) and
     that a consumer attached at seq 0 gets the fell-off-head `error` (reuse the
     `_eventually(lambda: turn.buffer.base > 0)` pattern from the existing
     fall-off tests). Then `gate.set()` and `await registry.cancel(...)`.
  2. `test_byte_budget_refunded_at_finalize` — run one full turn to completion;
     assert `registry._buffer_bytes_used == 0` after the terminal (every event's
     bytes refunded by `drop_all`). Run a second full turn; assert it still
     ends at `0` (no leak/accumulation across turns).
  3. `test_byte_budget_never_evicts_the_only_event` — set
     `stream_buffer_bytes = 1` (smaller than any single event), start a turn,
     let `meta` land; assert the buffer still has exactly that event readable
     (`len > 0`, `next_seq >= 1`) — the `len(self._events) > 1` guard holds, so
     the budget can't strand the buffer empty.
  4. Keep the existing `test_consumer_falling_off_the_head_is_terminated_with_error`
     and `test_fall_off_error_seq_reflects_buffer_base_not_stale_position`
     green — they exercise the EVENT cap path (`stream_buffer_size = 2`) and
     must still pass unchanged with the new constructor signature (update the
     `_RingBuffer(...)` call there if any test constructs one directly — search
     the test file; currently they go through `registry.start`, so the new
     kwargs flow automatically).

- **Acceptance criteria:**
  - [ ] `stream_buffer_bytes` exists in `Settings` with a documented default.
  - [ ] `TurnRegistry` holds a shared `_buffer_bytes_used` / budget accumulator.
  - [ ] `_RingBuffer.append` evicts on EITHER the event cap OR the byte budget,
        never evicting the sole event, refunding evicted bytes.
  - [ ] `_finalize` refunds the buffer's remaining bytes via `drop_all`.
  - [ ] After any turn terminates, `registry._buffer_bytes_used` returns to 0.
  - [ ] All four new/kept tests above pass; the existing fall-off tests pass.

---

### BC-02 — Consumer slot claimed before iteration: a never-driven `_follow` leaks the slot  [HIGH]

- **Files:** `app/turns.py` (`start`, `attach`, `_follow`).

- **Problem:** `start()` and `attach()` do `turn.consumers += 1`
  **synchronously**, before the returned async generator is ever iterated.
  `_follow` decrements only in its `finally`, which runs when the generator is
  *closed* (`aclose()`/GC). On the normal path the route's
  `EventSourceResponse(_encoded())` iterates and closes the generator, so the
  decrement happens. **But** if the response is created and the request is
  abandoned before ASGI drives the body (client RST during header send, an
  exception between the claim and the `return`, or any path where the body
  generator is never started/closed), `_follow.finally` never runs →
  `consumers` is never decremented. Leaked phantom consumers eventually hit
  `max_consumers_per_turn` (default 8) and 429 legitimate reattaches.

- **Fix:** Move the claim **into** `_follow` so claim and release are symmetric
  and both depend only on the generator actually running. The cap check stays in
  `attach` (it must reject *before* returning a handle), but the increment moves
  inside `_follow`'s `try`. Pass a flag so `_follow` knows whether to enforce
  the cap on its own first-iteration claim is unnecessary — the cap is already
  enforced in `attach`; `start`'s starter slot is uncapped by design (BC-18).

  *Before* (`start`):
  ```python
          turn.task = asyncio.create_task(self._drive(turn, source_config), name=f"turn-{session_id}")
          turn.consumers += 1  # the starter is the first consumer (decremented in _follow)
          return self._follow(turn, None)
  ```
  *After:*
  ```python
          turn.task = asyncio.create_task(self._drive(turn, source_config), name=f"turn-{session_id}")
          # The starter's consumer slot is claimed on the generator's FIRST
          # iteration (inside _follow), not here — a handle that is created but
          # never driven (client RST before ASGI starts the body) must not leak
          # a slot (BC-02). Release is symmetric in _follow's finally.
          return self._follow(turn, None)
  ```

  *Before* (`attach`):
  ```python
          max_consumers = getattr(self._settings, "max_consumers_per_turn", 8)
          if turn.consumers >= max_consumers:
              raise TooManyConsumers(session_id)
          turn.consumers += 1  # claimed synchronously here (decremented in _follow)
          return self._follow(turn, last_event_id)
  ```
  *After:*
  ```python
          max_consumers = getattr(self._settings, "max_consumers_per_turn", 8)
          if turn.consumers >= max_consumers:
              raise TooManyConsumers(session_id)
          # The cap is checked here (reject before handing out a handle), but the
          # increment happens on _follow's first iteration so an undriven handle
          # never leaks a slot (BC-02). Symmetric with the release in finally.
          return self._follow(turn, last_event_id)
  ```

  *Before* (`_follow`):
  ```python
      async def _follow(
          self, turn: _Turn, after_seq: int | None
      ) -> AsyncIterator[tuple[Event, int]]:
          """Yield ``(event, seq)`` from the buffer: replay, then live-follow."""
          buffer = turn.buffer
          seq = 0 if after_seq is None else after_seq + 1
          try:
              while True:
  ```
  *After:*
  ```python
      async def _follow(
          self, turn: _Turn, after_seq: int | None
      ) -> AsyncIterator[tuple[Event, int]]:
          """Yield ``(event, seq)`` from the buffer: replay, then live-follow.

          The consumer slot is claimed on entry (the first time the generator is
          actually driven) and released in ``finally`` — symmetric, so a handle
          created but never iterated (client RST before ASGI starts the body)
          never leaks a slot (BC-02).
          """
          buffer = turn.buffer
          seq = 0 if after_seq is None else after_seq + 1
          turn.consumers += 1
          try:
              while True:
  ```
  The `finally: turn.consumers -= 1` stays as-is.

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_undriven_handle_does_not_leak_a_consumer_slot` — call
     `registry.attach(session_id)` to get a handle, then **never iterate it**
     and let it be GC'd (or call `handle.aclose()` explicitly without iterating);
     assert `turn.consumers` is unchanged from before the attach. Concretely:
     start a gated turn, drive consumer 1 with a `Collector` to `first_delta`;
     record `turn.consumers`; create a second handle via `attach` but do not
     iterate it; `await asyncio.sleep(0)` and assert `turn.consumers` is still
     the pre-attach value (the un-iterated handle claimed nothing). Then
     `await handle.aclose()` and assert it is still unchanged (a closed-but-
     never-iterated generator's finally must not over-decrement).
  2. `test_cap_still_enforced_with_claim_in_follow` — keep the existing
     `test_per_turn_consumer_cap_raises_too_many_consumers` green; it now relies
     on the claim landing on first iteration, so it already drives c1/c2 via
     `Collector` and `_eventually(... consumers >= 2)` before the 3rd attach —
     verify that pattern still passes (the `Collector` drives the generators, so
     the slot is claimed). If timing makes it flaky, the existing
     `_eventually(lambda: registry._turns[session_id].consumers >= 2)` already
     waits for the claim — keep it.

- **Acceptance criteria:**
  - [ ] `turn.consumers += 1` appears ONLY inside `_follow` (grep confirms it is
        gone from `start`/`attach`).
  - [ ] The cap check stays in `attach` (reject-before-handle preserved).
  - [ ] An attached-but-never-iterated handle leaves `turn.consumers` unchanged.
  - [ ] `test_per_turn_consumer_cap_raises_too_many_consumers` still passes.

---

### BC-03 — Concurrent `cancel()` calls can double-append a terminal + double-persist  [HIGH]

- **Files:** `app/turns.py` (`cancel`, `_cancel_active`), interacts with
  `api/routes/me.py:_cancel_and_drop_threads` and `api/routes/sessions.py`
  cancel/delete routes.

- **Problem:** `cancel()` reads the guard (`not turn.cancel_requested` etc.) and
  then `await self._cancel_active(turn)`. `_cancel_active` sets
  `turn.cancel_requested = True` only as its first line. Two concurrent
  `cancel()` calls for the same session (e.g. the `POST .../cancel` route racing
  `delete_session_route → _cancel_and_drop_threads → registry.cancel`, or
  account-delete and chat-delete overlapping) can **both** pass the guard before
  either runs `_cancel_active` (the guard check and the flag set straddle an
  `await`). Both then run `task.cancel(); await task;
  _persist_partial_guarded(...); buffer.append(ev_done("cancelled"));
  _finalize(turn)`. `_finalize` is idempotent, but the **second**
  `buffer.append(ev_done("cancelled"))` runs *before* the idempotent
  `_finalize`, so a **second terminal `done` event** lands in the buffer (a
  replaying consumer sees two `done`s) and a redundant `_persist_partial` write
  fires.

- **Fix:** Set `turn.cancel_requested = True` **synchronously inside `cancel()`**
  (in the same await-free window as the guard check) before awaiting
  `_cancel_active`, and re-assert it is the *first* caller. BC-05's
  append-after-close guard is the second line of defense, but the primary fix is
  this synchronous flag flip so the second `cancel()` fails the guard.

  *Before* (`cancel`):
  ```python
      async def cancel(self, session_id: str) -> CancelOutcome:
          """G5: active → cancel-with-persistence (202); parked → unpark (204);
          idle (incl. cancel racing completion) → no-op (204)."""
          turn = self._turns.get(session_id)
          if (
              turn is not None
              and not turn.finalized
              and not turn.cancel_requested
              and turn.task is not None
              and not turn.task.done()
          ):
              await self._cancel_active(turn)
              return "cancelled"
          if await self._unpark_if_parked(session_id):
              return "unparked"
          return "idle"
  ```
  *After:*
  ```python
      async def cancel(self, session_id: str) -> CancelOutcome:
          """G5: active → cancel-with-persistence (202); parked → unpark (204);
          idle (incl. cancel racing completion) → no-op (204).

          The active-cancel claim is single-flight: ``cancel_requested`` is set
          SYNCHRONOUSLY here (no await between the guard read and the flag set),
          so two concurrent cancels (the cancel route racing a delete) can't both
          pass the guard and double-append the terminal / double-persist (BC-03).
          """
          turn = self._turns.get(session_id)
          if (
              turn is not None
              and not turn.finalized
              and not turn.cancel_requested
              and turn.task is not None
              and not turn.task.done()
          ):
              turn.cancel_requested = True  # claim the cancel before any await
              await self._cancel_active(turn)
              return "cancelled"
          if await self._unpark_if_parked(session_id):
              return "unparked"
          return "idle"
  ```

  *Before* (`_cancel_active`):
  ```python
      async def _cancel_active(self, turn: _Turn) -> None:
          """Cancel the task, await propagation, persist the partial, terminal."""
          turn.cancel_requested = True
          task = turn.task
  ```
  *After:*
  ```python
      async def _cancel_active(self, turn: _Turn) -> None:
          """Cancel the task, await propagation, persist the partial, terminal.

          ``cancel_requested`` is already set by the single caller ``cancel``
          (BC-03) — set defensively here too so a direct call (tests) is safe.
          """
          turn.cancel_requested = True  # idempotent — cancel() already set it
          task = turn.task
  ```

  Note: keep the defensive set in `_cancel_active` so a unit test calling it
  directly still behaves, but the *real* single-flight guarantee now comes from
  `cancel()`'s synchronous flip. The aclose drain (BC-15) routes through
  `cancel()`, so it inherits the guard.

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_concurrent_cancel_produces_exactly_one_terminal_and_one_persist` —
     start a gated turn (`_gated_model(gate, _LONG_CHUNK)`, never set the gate),
     drive a `Collector` to `first_delta`. Then fire **two** cancels
     concurrently: `await asyncio.gather(registry.cancel(sid),
     registry.cancel(sid))`. Assert the two outcomes are `{"cancelled", "idle"}`
     (exactly one wins the active path; the other falls through to idle — the
     turn is already finalized/evicted by the time the loser re-reads
     `self._turns`). Drain the collector; assert:
     - `[e.type for e,_ in pairs].count("done") == 1`
     - `pairs[-1][0].data["status"] == "cancelled"`
     - `"error" not in [e.type for e,_ in pairs]`
     - exactly one `turn_records[-1]` with `status == "cancelled"` (count
       records: `len(values["turn_records"]) == 1`).
     To count persist calls deterministically, monkeypatch/spy
     `registry._persist_partial` (wrap it, count invocations) and assert it ran
     exactly once.
  2. Keep `test_cancel_active_persists_partial_and_emits_done_cancelled` green.

- **Acceptance criteria:**
  - [ ] `cancel()` sets `turn.cancel_requested = True` synchronously before the
        `await self._cancel_active(turn)`.
  - [ ] Two concurrent `cancel()` calls yield exactly one `"cancelled"` and one
        `"idle"` outcome.
  - [ ] The buffer contains exactly one `done` event; `_persist_partial` ran
        exactly once.

---

### BC-04 — `_drive`'s `finally` can append `error` after `_cancel_active` appended `done`  [HIGH]

- **Files:** `app/turns.py` (`_drive` finally, `_cancel_active`).

- **Problem:** The honesty contract relies on `cancel_requested` being `True`
  when `_drive`'s `finally` runs so it skips appending its safety-net
  `ev_error`. On the normal cancel path that holds (`cancel()` now sets the flag
  synchronously — BC-03). The documented edge is: the task is cancelled by
  something **other** than our cancel path (an abrupt shutdown cancelling the
  bare `create_task`). Then `cancel_requested` is `False`, the finally appends
  `ev_error` and finalizes — the intended safety net. The risk is the *overlap*:
  if a loop-shutdown cancellation of the `_drive` task races our own
  `_cancel_active` (which also `task.cancel()`s then appends `done`), the
  ordering of "who appends the terminal" is not serialized, and `terminal_appended`
  is a plain bool mutated across `await` points — a double terminal (one
  `error`, one `done`) or an append racing the buffer close can result.

- **Fix:** Two parts. (1) BC-05's append-after-close guard makes the *second*
  append a no-op once the buffer is closed — that already closes the worst case
  (a terminal landing after `_finalize → buffer.close()`). (2) Tighten the
  `_drive` finally so the terminal-append decision checks `terminal_appended`
  (already set by `_cancel_active` *before* its `buffer.append` — verify the
  ordering) AND `cancel_requested`, and make the finalize call idempotent-safe.
  The key invariant to enforce: **only one writer appends the terminal**, gated
  by the combination of `cancel_requested` (our cancel path owns it) and
  `terminal_appended` (any path that already appended).

  *Before* (`_drive` finally):
  ```python
          finally:
              # The honesty contract: every stream MUST end with a terminal event.
              # If the task was cancelled by something OTHER than our own cancel
              # path (an abrupt shutdown cancelling the bare task, say), no
              # done/error was ever appended — without this, an attached consumer's
              # stream would end on a silent buffer close. Append one error so no
              # stream ever closes silently. (Our own cancel path owns the
              # single-shot done(cancelled), guarded by cancel_requested.)
              if not turn.cancel_requested and not turn.terminal_appended:
                  turn.terminal_appended = True
                  turn.buffer.append(ev_error(_USER_SAFE_ERROR, turn.trace_id))
              if not turn.cancel_requested:
                  self._finalize(turn)
              self._log_complete(turn, start_mono)
  ```
  *After:*
  ```python
          finally:
              # The honesty contract: every stream MUST end with exactly ONE
              # terminal event. Our own cancel path (cancel_requested) owns the
              # single-shot done(cancelled) and the finalize — skip both here so
              # we never race a second terminal onto the buffer (BC-04). For any
              # OTHER termination (an abrupt shutdown cancelling the bare task, a
              # post-stream crash that already set terminal_appended), append a
              # safety-net error ONLY if nothing terminal landed yet, then
              # finalize. buffer.append is a no-op once closed (BC-05), so even a
              # lost race can't push an event past the terminal.
              if not turn.cancel_requested:
                  if not turn.terminal_appended:
                      turn.terminal_appended = True
                      turn.buffer.append(ev_error(_USER_SAFE_ERROR, turn.trace_id))
                  self._finalize(turn)
              self._log_complete(turn, start_mono)
  ```
  (This collapses the two `if not turn.cancel_requested` checks into one block —
  cleaner and makes the "cancel path owns everything" intent explicit. Behavior
  is identical on every path except it can no longer interleave a finalize
  between the error-append and itself.)

  Verify in `_cancel_active` that `terminal_appended = True` is set *before*
  `buffer.append(ev_done("cancelled"))` (it already is — line order:
  `turn.terminal_appended = True` then `turn.buffer.append(...)`). Keep that
  order.

- **Tests to add** (`tests/app/test_turns.py`):
  1. Keep `test_external_task_cancel_still_emits_terminal_error` green (it
     already covers the abrupt-cancel safety net: cancel the bare `turn.task`,
     assert the stream ends with `error` and no `done`).
  2. `test_external_cancel_racing_our_cancel_yields_single_terminal` — start a
     gated turn, drive a `Collector` to first delta. Concurrently: cancel the
     bare task (`turn.task.cancel()`) AND call `registry.cancel(sid)`, gathered.
     Drain the collector; assert the stream ends with exactly one terminal
     (`[t for t in types if t in ("done","error")]` has length 1) and nothing
     follows it. (The append-after-close guard + the finally collapse guarantee
     this regardless of which path wins.)

- **Acceptance criteria:**
  - [ ] `_drive`'s finally has a single `if not turn.cancel_requested:` block
        owning both the safety-net error append and the finalize.
  - [ ] `_cancel_active` sets `terminal_appended = True` before its
        `buffer.append(ev_done(...))`.
  - [ ] A turn racing external-cancel + registry-cancel ends with exactly one
        terminal event, nothing after it.

---

### BC-05 — `_RingBuffer.append` has no `closed` guard  [HIGH]

- **Files:** `app/turns.py` (`_RingBuffer.append`).

- **Problem:** `close()` only flips `self.closed = True`; `append()` never checks
  it. Any append after close (the BC-03/BC-04 double-terminal races, or a late
  `_observe`/enrichment) still mutates `self._events`, advances `next_seq`, and
  re-fires the flag — a consumer mid-loop can yield a post-terminal event,
  violating "exactly one terminal event, nothing after it".

- **Fix:** **Already included in BC-01's `_RingBuffer` rewrite** — the new
  `append` opens with:
  ```python
          if self.closed:
              logger.warning("append after close ignored (type=%s)", event.type)
              return
  ```
  If BC-01 is implemented as specified, this is satisfied. If for any reason
  BC-01's full rewrite is deferred, this guard MUST still be added standalone at
  the top of the existing `append`. Do not ship Phase 1 without it.

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_append_after_close_is_a_noop` — construct a `_RingBuffer` directly
     (with no-op `on_charge`/`on_refund` lambdas, e.g.
     `_RingBuffer(10, on_charge=lambda n: 1_000, on_refund=lambda n: None)`),
     append one event, `next_seq == 1`, then `close()`, then
     `append(ev_done("complete"))`; assert `next_seq` is still `1` and the buffer
     did not grow (the post-close append was dropped). Assert the warning was
     logged (`caplog`).

- **Acceptance criteria:**
  - [ ] `_RingBuffer.append` returns early (no mutation) when `self.closed`.
  - [ ] A post-close append does not advance `next_seq` and logs a warning.

---

### BC-06 — Last-Event-ID ahead of the buffer silently skips a new turn's early events  [HIGH]

- **Files:** `app/turns.py` (`_follow`), `api/routes/sessions.py`
  (`_parse_last_event_id`, `stream_session` — no wire change).

- **Problem:** `seq` is per-turn-buffer, not per-session. `_follow` computes
  `seq = after_seq + 1`. If a client reconnects with a `Last-Event-ID` from a
  **previous** turn that is now larger than the *new* turn's `next_seq` (saw
  seq 50 on turn A; A finalized + evicted; a NEW turn started with a fresh
  buffer at base 0, `next_seq` small; client reconnects with
  `Last-Event-ID: 50`), then `seq = 51`. `seq < buffer.base` is false (base 0),
  `seq < buffer.next_seq` is false (next_seq small) → it goes straight to
  `await flag.wait()`, blocking until the new turn produces 51 events and
  **silently skipping events 1..50** of the new turn — corrupted prose, the
  exact honesty failure the fell-off-head path exists to prevent, but here it
  sails past undetected.

- **Fix:** When the requested cursor is **ahead of** the buffer's current
  `next_seq` at attach time, the cursor is stale/foreign (from a previous turn).
  Treat it as a full replay from base — never block waiting for a future seq.
  Detect it once, at the top of `_follow`, before the loop.

  *Before* (`_follow`, after the `turn.consumers += 1` from BC-02):
  ```python
          buffer = turn.buffer
          seq = 0 if after_seq is None else after_seq + 1
          turn.consumers += 1
          try:
              while True:
                  flag = buffer.flag  # capture BEFORE the checks — no missed wakeup
                  if seq < buffer.base:
  ```
  *After:*
  ```python
          buffer = turn.buffer
          seq = 0 if after_seq is None else after_seq + 1
          # A cursor AHEAD of the buffer (after_seq + 1 > next_seq) is stale or
          # foreign — it belongs to a PREVIOUS turn whose buffer was evicted and
          # replaced by this turn's fresh buffer (seq is per-turn, not
          # per-session). Blocking on a future seq would silently skip this
          # turn's early events (BC-06). Reset to a full replay from the head.
          if seq > buffer.next_seq:
              logger.info(
                  "Last-Event-ID %d ahead of buffer next_seq %d (foreign cursor) "
                  "— full replay from base (session_id=%s)",
                  after_seq,
                  buffer.next_seq,
                  turn.session_id,
              )
              seq = buffer.base
          turn.consumers += 1
          try:
              while True:
                  flag = buffer.flag  # capture BEFORE the checks — no missed wakeup
                  if seq < buffer.base:
  ```
  (`seq == next_seq` is the legitimate "I'm caught up, wait for the next event"
  case — only `seq > next_seq` is impossible-for-this-turn and must reset. Using
  `seq = buffer.base` rather than `0` is correct because the head may already
  have evicted — a base-anchored replay then trips the honest fell-off path on
  the first read only if the consumer truly can't be served, never a silent
  skip.)

  Add a one-line clarifying comment to `_parse_last_event_id` in
  `api/routes/sessions.py` (BC-16 — the clamp is a sanity ceiling, not the real
  guard): see BC-16 below. No wire-protocol change (per master plan §5).

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_foreign_last_event_id_full_replays_not_silent_skip` — start a turn,
     run it to completion, capture the highest seq seen (e.g. `top_seq`). Start
     a SECOND turn on the same session (new buffer, base 0). While it streams
     (gated model), `attach(session_id, last_event_id=top_seq + 5)` (a cursor
     far ahead of the new buffer). Assert the attached consumer receives the new
     turn's events **from the head** — its first received `seq` is `0` (or
     `buffer.base` if eviction occurred), and it sees the `meta` event of the
     new turn (no silent skip). Crucially assert the consumer is NOT blocked
     forever: it terminates with the new turn's terminal once the gate releases.
  2. `test_caught_up_cursor_waits_then_follows_live` — guard against a
     regression where `seq == next_seq` is wrongly treated as foreign: attach
     mid-stream with `last_event_id = last_seq_seen` (exactly caught up), release
     the gate, assert it follows live from `last_seq_seen + 1` contiguously
     (this is the existing `test_exact_replay_from_last_event_id_mid_stream`
     shape — confirm it still passes; the new `seq > next_seq` guard must not
     trip on `seq == next_seq`).

- **Acceptance criteria:**
  - [ ] `_follow` resets `seq` to `buffer.base` when `seq > buffer.next_seq` at
        attach, logging the foreign-cursor reset.
  - [ ] A reconnect with a previous-turn cursor full-replays the new turn from
        its head (never silently skips its early events, never blocks forever).
  - [ ] `test_exact_replay_from_last_event_id_mid_stream` still passes
        (caught-up cursor follows live, not treated as foreign).

---

### BC-07 — `_observe` enrichment is on the producer critical path: keep it O(1) and document the invariant  [HIGH (operational)]

- **Files:** `app/turns.py` (`_observe`).

- **Problem:** `_drive`'s single producer loop does
  `turn.buffer.append(self._observe(turn, event))`. `_observe` runs
  `enrich_usage_event(...)` synchronously for `usage` events. Any per-event work
  in `_observe` serializes the stream — consumer-visible latency and the
  watchdog budget both depend on `_observe` staying cheap. It is currently cheap;
  the hazard is a *future* heavier enrichment silently regressing streaming
  latency. Per the leave-alone note, the fix is **NOT** to move enrichment off
  the loop (YAGNI) — it is to pin the invariant in code + a test.

- **Fix:** Add a clear invariant comment at the top of `_observe`, and ensure no
  per-event allocation beyond the existing usage-enrichment (which is itself
  guarded). No structural change.

  *Before* (`_observe` docstring):
  ```python
      def _observe(self, turn: _Turn, event: Event) -> Event:
          """Track identity/emissions/usage from the stream; enrich usage events."""
  ```
  *After:*
  ```python
      def _observe(self, turn: _Turn, event: Event) -> Event:
          """Track identity/emissions/usage from the stream; enrich usage events.

          INVARIANT (BC-07): this runs on the SINGLE producer loop in ``_drive``
          — it is the only thing between the model stream and the consumer-
          visible buffer. It MUST stay O(1) per event and do no I/O / no awaits.
          ``enrich_usage_event`` (the one non-trivial call) runs once per turn
          (usage is terminal-ish) and is guarded. If any enrichment ever grows
          heavy or needs I/O, move it OFF this loop (enrich lazily at yield,
          cached) — never block the producer. Do not add per-event work here.
          """
  ```

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_observe_is_pure_and_non_blocking` — a unit test that calls
     `registry._observe(turn, ev_delta("hi"))` directly on a freshly-constructed
     `_Turn` and asserts: it returns the same event object (delta path is
     pass-through), it appends to `turn.emissions` exactly once, and it does not
     await (the method is `def`, not `async def` — assert
     `not asyncio.iscoroutinefunction(registry._observe)`). For the usage path,
     assert that a single `usage` event triggers exactly one
     `enrich_usage_event` call (spy/monkeypatch a counter) — i.e. enrichment is
     not invoked per non-usage event.

- **Acceptance criteria:**
  - [ ] `_observe` carries the BC-07 invariant docstring.
  - [ ] `_observe` remains a synchronous (`def`) method with no awaits.
  - [ ] The test pins that delta/step/thinking events incur no enrichment call.

---

### BC-08 — A DB hang in partial-persist holds the single-flight session claim forever  [MEDIUM]

- **Files:** `app/turns.py` (`_persist_partial_guarded`, `_cancel_active`,
  `_handle_timeout`, `_finalize`).

- **Problem:** `_finalize` (which does `del self._turns[session_id]` — releasing
  the single-flight claim) runs *after* `_persist_partial_guarded` in both the
  cancel and timeout paths. `_persist_partial` issues `aget_state` +
  `aupdate_state` with **no timeout of their own**. If the DB is *why* the turn
  timed out (or is wedged during cancel), these awaits can hang, so `_finalize`
  never runs, the session claim stays in `self._turns`, and the session is 409'd
  forever (a permanent per-session lockout from a wedged DB).

- **Fix:** Bound the partial-persist with its own short `asyncio.timeout`, and —
  critically — **finalize the turn even if persistence times out**. Wrap each
  `_persist_partial` attempt inside `_persist_partial_guarded` in a timeout; on
  timeout, log and fall through (the existing retry/swallow already swallows
  failures — a `TimeoutError` is just another failure to swallow). The terminal
  event + finalize must not depend on the persist succeeding.

  Add a setting for the persist timeout in `config/settings.py` (Turn registry
  block):
  ```python
      # Bound each partial-persist DB round so a wedged DB at cancel/timeout
      # can't hold the single-flight session claim forever (BC-08). On timeout
      # the partial is lost (logged) but the turn still finalizes + frees the
      # claim — a stuck DB never permanently 409s a session.
      persist_partial_timeout_s: float = 5.0
  ```

  *Before* (`_persist_partial_guarded`):
  ```python
      async def _persist_partial_guarded(
          self, turn: _Turn, *, status: str, error: dict[str, Any] | None
      ) -> None:
          """Best-effort partial persistence — a write failure must never block
          the terminal event the consumer is waiting on. One immediate retry (no
          backoff): the partial the student watched stream should survive a
          transient DB blip; a second failure is logged and swallowed."""
          try:
              await self._persist_partial(turn, status=status, error=error)
              return
          except Exception:
              logger.warning(
                  "partial-turn persistence failed — retrying once (session_id=%s, status=%s)",
                  turn.session_id,
                  status,
                  exc_info=True,
              )
          try:
              await self._persist_partial(turn, status=status, error=error)
          except Exception:
              logger.exception(
                  "partial-turn persistence failed after retry (session_id=%s, status=%s)",
                  turn.session_id,
                  status,
              )
  ```
  *After:*
  ```python
      async def _persist_partial_guarded(
          self, turn: _Turn, *, status: str, error: dict[str, Any] | None
      ) -> None:
          """Best-effort partial persistence — a write failure (or a DB HANG)
          must never block the terminal event or hold the single-flight claim
          (BC-08). Each attempt is bounded by ``persist_partial_timeout_s``; a
          timeout is swallowed like any other failure so the caller proceeds to
          the terminal + finalize. One immediate retry (no backoff): the partial
          the student watched stream should survive a transient DB blip; a second
          failure (or timeout) is logged and swallowed."""
          timeout_s = getattr(self._settings, "persist_partial_timeout_s", 5.0)
          for attempt in ("first", "retry"):
              try:
                  async with asyncio.timeout(timeout_s):
                      await self._persist_partial(turn, status=status, error=error)
                  return
              except TimeoutError:
                  logger.warning(
                      "partial-turn persistence timed out after %ss (%s attempt) "
                      "— the turn still finalizes (session_id=%s, status=%s)",
                      timeout_s,
                      attempt,
                      turn.session_id,
                      status,
                  )
              except Exception:
                  logger.warning(
                      "partial-turn persistence failed (%s attempt) "
                      "(session_id=%s, status=%s)",
                      attempt,
                      turn.session_id,
                      status,
                      exc_info=True,
                  )
          logger.error(
              "partial-turn persistence gave up after retry (session_id=%s, status=%s)",
              turn.session_id,
              status,
          )
  ```
  No change needed in `_cancel_active`/`_handle_timeout` — they already call
  `_persist_partial_guarded` then proceed to the terminal + finalize; the
  timeout now guarantees that "proceed" actually happens.

  **Important:** `asyncio.timeout` cancels the inner await on expiry. If
  `_persist_partial`'s `aupdate_state` is mid-write when cancelled, that is the
  same as any failed write (the partial may or may not have landed) — acceptable
  per the "best-effort partial" contract (BC-09's single-owner extraction in
  Phase 3 will inherit this timeout wrapper; see Cross-phase notes).

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_partial_persist_db_hang_still_finalizes_and_frees_the_claim` — wrap
     the rig's graph so `aupdate_state` hangs forever (an `asyncio.Event` never
     set, or `await asyncio.sleep(1e9)`); set
     `settings.persist_partial_timeout_s = 0.05`. Start a gated turn, drive to
     first delta, `await registry.cancel(sid)`. Assert: `cancel` returns
     `"cancelled"` (didn't hang), the consumer's stream ends with
     `done(cancelled)`, and `registry.is_generating(sid) is False` (the claim
     was freed despite the hung persist). Use `asyncio.wait_for(..., timeout=2)`
     around the cancel so a regression (hang) fails loudly instead of hanging
     the suite.
  2. `test_partial_persist_timeout_does_not_emit_double_terminal` — same hang
     rig; assert the buffer still has exactly one terminal.

- **Acceptance criteria:**
  - [ ] `persist_partial_timeout_s` exists in `Settings`.
  - [ ] `_persist_partial_guarded` bounds each attempt with `asyncio.timeout`.
  - [ ] A hung DB at cancel/timeout still finalizes the turn and frees the
        session claim (no permanent 409).

---

### BC-10 — Centralize `_turns` mutation; keep the claim window await-free  [MEDIUM]

- **Files:** `app/turns.py` (`is_generating`, `start`, `attach`, `_finalize`).

- **Problem:** `_turns` is read/written from both the request task
  (`start`/`attach`/`is_generating`) and the detached task (`_finalize`'s
  `del`). asyncio's single thread makes dict ops atomic between awaits, and
  `start`'s check-and-claim is correctly await-free — but the mutation is not
  centralized, and the real future risk is someone adding an `await` inside the
  `start` check-and-claim window, silently breaking single-flight.
  `list_sessions_route` reads `is_generating` in a comprehension (cosmetic stale
  dot — acceptable).

- **Fix:** This is a low-value/low-risk hardening — do the cheap part only
  (KISS): add an explicit assert-style comment marking the await-free claim
  window, and a tiny synchronous helper for the claim so the invariant is
  visible. Do **not** introduce a lock (no contention exists on a single thread;
  a lock would be the "enterprise completeness" the CLAUDE.md rules forbid).

  In `start`, annotate the claim window. The block from `if session_id in
  self._turns:` through `self._turns[session_id] = turn` must stay await-free.
  Add a comment and keep the existing structure:

  *Before:*
  ```python
          if session_id in self._turns:
              raise StreamActive(session_id)
  ```
  *After:*
  ```python
          # --- single-flight claim window: NO `await` from here through the
          # `self._turns[session_id] = turn` assignment below (BC-10). asyncio's
          # cooperative scheduling makes this check-and-claim atomic only because
          # nothing yields inside it — adding an await here would let two POSTs
          # both pass the check and double-claim the session. The rewrite-history
          # await is AFTER the claim (the claim is held across it), which is
          # correct: the claim is released in the `except BaseException` below if
          # the rewrite fails.
          if session_id in self._turns:
              raise StreamActive(session_id)
  ```

  No functional change. (The `_turns` mutation in `_finalize` already guards with
  `if self._turns.get(turn.session_id) is turn:` — keep it.)

- **Tests to add** (`tests/app/test_turns.py`):
  1. Keep `test_double_send_raises_stream_active` and
     `test_global_concurrent_turn_cap_raises_too_many_turns` green (they exercise
     the claim). No new behavior to test — this is a documentation/invariant fix.
     A reviewer verifies by reading: confirm there is no `await` between the
     `if session_id in self._turns` check and the `self._turns[session_id] =
     turn` assignment.

- **Acceptance criteria:**
  - [ ] The claim window in `start` carries the BC-10 await-free invariant
        comment.
  - [ ] No `await` appears between the single-flight check and the claim.
  - [ ] No lock was added (verify: this is intentional).

---

### BC-12 — Pre-`start()` title + source-config writes persist on 409/503/422  [MEDIUM]

- **Files:** `api/routes/sessions.py` (`post_message`).

- **Problem:** `post_message` writes `set_session_source_config` and
  `set_session_title` **before** `registry.start(...)`. If `start()` rejects
  (409 `StreamActive`, 503 `TooManyTurns`, 422 `InvalidEditTarget`), the
  session's stored `source_config` has already been overwritten by the rejected
  message's config and the title stamped from a prompt that never ran. A 409
  (double-submit, very common with SSE retries) corrupts sticky source-config
  (PRD story 10) and titles the chat from a rejected prompt.

- **Fix:** Move the title + source-config writes to **after** a successful
  `start()` claim. Re-order `post_message` so `start()` is attempted first
  (under the single-flight claim), and only on success do the side-effect writes
  run. Because `start()` is the thing that can 409/503/422, nothing persists for
  a rejected message.

  One subtlety: `run_turn` itself calls `_ensure_session` with the request's
  `source_config` (passed through `registry.start(..., source_config)`), so the
  effective config for THIS turn is already correct inside the run. The route's
  `set_session_source_config` write is the **sticky persistence** (story 10) and
  the title write is cosmetic — both are safe to do after the claim. Move them to
  just before `return _sse_response(...)`.

  *Before:*
  ```python
      sid = str(session_id)
      trace_id = getattr(request.state, "trace_id", None)
      settings = request.app.state.settings
      pool = request.app.state.runtime.app_pool

      # Source-config stickiness (PRD story 10): a per-message toggle is upserted
      # onto the row so it survives devices/cleared storage; the session read seeds
      # the dropdown from it. Done before the turn starts.
      if body.source_config is not None:
          await set_session_source_config(pool, sid, body.source_config.model_dump(mode="json"))

      # Default title on first message: stamp the (truncated) question so the chat
      # has a name immediately; the on_turn_complete hook may upgrade it later.
      if row.get("title") is None:
          await set_session_title(pool, sid, default_title(body.text, settings.title_max_len))

      try:
          stream = await _registry(request).start(
              sid,
              body.text,
              body.source_config,
              user_id=str(user.id),
              replace_message_id=body.replace_message_id,
          )
      except StreamActive:
          return _error_json(  # type: ignore[return-value]
              409, "A turn is already streaming for this session.", trace_id
          )
      except TooManyTurns:
          return _error_json(  # type: ignore[return-value]
              503, "We're at capacity right now — please try again in a moment.", trace_id
          )
      except InvalidEditTarget:
          # Never forward str(exc) to the client — the message is internal; a
          # fixed user-safe line goes out, the detail is logged server-side.
          logger.warning("invalid edit target", session_id=sid, exc_info=True)
          return _error_json(422, "That message can't be edited.", trace_id)  # type: ignore[return-value]

      return _sse_response(stream, request)
  ```
  *After:*
  ```python
      sid = str(session_id)
      trace_id = getattr(request.state, "trace_id", None)
      settings = request.app.state.settings
      pool = request.app.state.runtime.app_pool

      # Claim the session FIRST (single-flight): a rejected start (409/503/422)
      # must NOT mutate the stored source-config or stamp a title from a prompt
      # that never ran (BC-12). The per-turn effective config is passed into
      # start() directly; the sticky persistence + default title land only after
      # the claim succeeds.
      try:
          stream = await _registry(request).start(
              sid,
              body.text,
              body.source_config,
              user_id=str(user.id),
              replace_message_id=body.replace_message_id,
          )
      except StreamActive:
          return _error_json(  # type: ignore[return-value]
              409, "A turn is already streaming for this session.", trace_id
          )
      except TooManyTurns:
          return _error_json(  # type: ignore[return-value]
              503, "We're at capacity right now — please try again in a moment.", trace_id
          )
      except InvalidEditTarget:
          # Never forward str(exc) to the client — the message is internal; a
          # fixed user-safe line goes out, the detail is logged server-side.
          logger.warning("invalid edit target", session_id=sid, exc_info=True)
          return _error_json(422, "That message can't be edited.", trace_id)  # type: ignore[return-value]

      # The claim succeeded — now persist the side effects (BC-12).
      # Source-config stickiness (PRD story 10): upsert the per-message toggle so
      # it survives devices/cleared storage; the session read seeds the dropdown.
      if body.source_config is not None:
          await set_session_source_config(pool, sid, body.source_config.model_dump(mode="json"))
      # Default title on first message: stamp the (truncated) question so the chat
      # has a name immediately; the on_turn_complete hook may upgrade it later.
      if row.get("title") is None:
          await set_session_title(pool, sid, default_title(body.text, settings.title_max_len))

      return _sse_response(stream, request)
  ```

  **Edge to verify:** `start()` spawns the detached `_drive` task before the
  route's post-claim writes run. The writes are quick upserts on
  `counselle.sessions`; the detached turn reads the row via `_ensure_session`
  with the request's `source_config` already in hand, so there is no read-write
  race that affects the turn's behavior. If a reviewer worries about the title
  write racing the `on_turn_complete` auto-titler, note: the default-title write
  is guarded by `row.get("title") is None` (only first message) and the
  auto-titler runs at the terminal (after), so the ordering is: default title
  now → auto-title later. Unchanged from before; only the timing relative to the
  claim moved.

- **Tests to add** (`tests/api/test_routes_unit.py` — the route-level test file;
  if a registry-level test is easier given the rig, place it in
  `tests/app/test_turns.py` only if it can exercise the route, otherwise use the
  api test harness):
  1. `test_409_does_not_overwrite_source_config_or_title` — using the API test
     client (see `tests/api/conftest.py` for the auth + app fixtures): POST a
     first message (claims the session, starts a turn). While it is in flight,
     POST a SECOND message with a DIFFERENT `source_config` and a different text
     → expect 409. Then assert the stored row's `source_config` still equals the
     FIRST message's config (not the rejected second one) and the title is from
     the first message (not the rejected second). Read the row via the session
     GET or the pool fixture.
  2. If the api harness can't easily hold a turn in-flight, assert the weaker but
     still meaningful property: a 422 (`replace_message_id` = a bogus id on a
     fresh session) leaves `source_config`/`title` unwritten — POST with a
     `source_config` + a bogus `replace_message_id`, expect 422, assert the row's
     `source_config` is still the session's original (creation-time) config and
     `title` is still `None`.

- **Acceptance criteria:**
  - [ ] In `post_message`, `registry.start(...)` is attempted before any
        `set_session_source_config` / `set_session_title` write.
  - [ ] A 409/503/422 path returns without persisting title or source-config.
  - [ ] A successful start still persists sticky source-config + default title.

---

### BC-15 — Shutdown drain mislabels in-flight turns `cancelled` instead of `error`  [MEDIUM]

- **Files:** `app/turns.py` (`aclose`, plus a new drain path; `_cancel_active`,
  `_handle_timeout` for reference).

- **Problem:** `aclose()` drains by calling `self.cancel(session_id)` on each
  live turn. For an *active* turn that runs the full cancel path — partial
  persisted with `status="cancelled"` and a `done(cancelled)` terminal. On a
  clean redeploy this turns every in-flight answer into a `cancelled` turn record
  even though the student never pressed stop — exactly the mislabel the watchdog
  deliberately avoids (it uses `status="error"`, "the student didn't press
  stop"). The transcript then shows `cancelled` for turns killed by a deploy,
  which is a small honesty/UX inaccuracy and confusing for debugging.

  Note also: `DoneStatus = Literal["complete", "awaiting_input", "cancelled"]`
  — there is **no** `done(error)`; server-side termination uses `ev_error`, not
  `ev_done`. So the shutdown drain's terminal must be `ev_error`, matching the
  watchdog, not a `done` of any kind.

- **Fix:** Give `aclose` a distinct drain path that, for an *active* turn,
  persists the partial with `status="error"` (server-side termination) and
  appends an `ev_error` terminal — NOT `done(cancelled)`. Parked turns are not in
  `_turns` (they finalized at `done(awaiting_input)`), so the only `_turns`
  entries at shutdown are active turns; but to be safe, route parked-shaped
  sessions through `_unpark_if_parked` exactly as `cancel` does. Implement a
  `_drain_active(turn)` that mirrors `_cancel_active` but with error semantics,
  and have `aclose` call a `_terminate_for_shutdown(session_id)` that uses it.

  *Before* (`aclose`):
  ```python
      async def aclose(self) -> None:
          """Drain every in-flight turn — their final state writes land NOW,
          before the caller closes the pools (the shutdown ordering rule).

          Catches ``BaseException`` per session so one failure (incl. a
          ``CancelledError`` raised during drain) never leaves the rest
          undrained; the first ``CancelledError`` seen is re-raised after the loop
          so a shutdown cancellation still propagates."""
          first_cancelled: asyncio.CancelledError | None = None
          for session_id in list(self._turns):
              try:
                  await self.cancel(session_id)
              except asyncio.CancelledError as exc:
                  if first_cancelled is None:
                      first_cancelled = exc
                  logger.warning("registry drain cancelled (session_id=%s)", session_id)
              except BaseException:
                  logger.exception("registry drain failed (session_id=%s)", session_id)
          # Drain the tracked async on_turn_complete hook tasks so none outlives
          # the registry against a closing pool (their exceptions are guarded).
          if self._hook_tasks:
              await asyncio.gather(*self._hook_tasks, return_exceptions=True)
          if first_cancelled is not None:
              raise first_cancelled
  ```
  *After:*
  ```python
      async def aclose(self) -> None:
          """Drain every in-flight turn — their final state writes land NOW,
          before the caller closes the pools (the shutdown ordering rule).

          A SHUTDOWN drain is NOT a user cancel: an active turn killed by a
          redeploy is terminated with ``error`` (server-side termination), NOT
          ``done(cancelled)`` — the student never pressed stop, so the transcript
          must not read ``cancelled`` (BC-15, mirrors the watchdog's choice).
          Parked sessions (no live task) are unparked as usual.

          Catches ``BaseException`` per session so one failure (incl. a
          ``CancelledError`` raised during drain) never leaves the rest
          undrained; the first ``CancelledError`` seen is re-raised after the loop
          so a shutdown cancellation still propagates."""
          first_cancelled: asyncio.CancelledError | None = None
          for session_id in list(self._turns):
              try:
                  await self._terminate_for_shutdown(session_id)
              except asyncio.CancelledError as exc:
                  if first_cancelled is None:
                      first_cancelled = exc
                  logger.warning("registry drain cancelled (session_id=%s)", session_id)
              except BaseException:
                  logger.exception("registry drain failed (session_id=%s)", session_id)
          # Drain the tracked async on_turn_complete hook tasks so none outlives
          # the registry against a closing pool (their exceptions are guarded).
          if self._hook_tasks:
              await asyncio.gather(*self._hook_tasks, return_exceptions=True)
          if first_cancelled is not None:
              raise first_cancelled

      async def _terminate_for_shutdown(self, session_id: str) -> None:
          """Shutdown drain for one session: an ACTIVE turn is terminated with
          ``error`` (server-side, not a user cancel — BC-15); anything else
          (parked / idle) routes through the normal cancel/unpark path."""
          turn = self._turns.get(session_id)
          if (
              turn is not None
              and not turn.finalized
              and not turn.cancel_requested
              and turn.task is not None
              and not turn.task.done()
          ):
              turn.cancel_requested = True  # claim it (same single-flight as cancel, BC-03)
              await self._drain_active_with_error(turn)
              return
          await self._unpark_if_parked(session_id)
  ```

  Add `_drain_active_with_error`, a near-twin of `_cancel_active` but with error
  semantics (status="error" persist + `ev_error` terminal):
  ```python
      async def _drain_active_with_error(self, turn: _Turn) -> None:
          """Shutdown twin of ``_cancel_active`` (BC-15): cancel the task, await
          propagation, persist the partial as ``error`` (server-side
          termination), append the single-shot ``error`` terminal, finalize.

          The ``cancel_requested`` flag is already set by the caller so
          ``_drive``'s finally skips its own terminal (same contract as cancel)."""
          task = turn.task
          if task is None:
              return
          task.cancel()
          try:
              await task
          except asyncio.CancelledError:
              pass
          except Exception:
              logger.exception("drained turn task raised (session_id=%s)", turn.session_id)
          await self._persist_partial_guarded(
              turn,
              status="error",
              error={"message": _USER_SAFE_ERROR, "trace_id": turn.trace_id},
          )
          turn.terminal_appended = True
          turn.buffer.append(ev_error(_USER_SAFE_ERROR, turn.trace_id))
          self._finalize(turn)
  ```

  **Cross-phase note (BC-09):** `_drain_active_with_error`, `_cancel_active`,
  and `_handle_timeout` now share the "cancel task → await → persist → terminal
  → finalize" shape with only the status/terminal-kind differing. Phase 3's H1/
  BC-09 single-owner persistence extraction should fold these into one
  parametrized helper. For Phase 1, keep them explicit (don't pre-build Phase 3's
  abstraction) but add a `# Phase 3 (BC-09): fold with _cancel_active` breadcrumb
  comment above `_drain_active_with_error`.

- **Tests to add** (`tests/app/test_turns.py`):
  1. `test_aclose_terminates_active_turn_with_error_not_cancelled` — a NEW test
     (the existing `test_aclose_drains_in_flight_turns_and_lands_their_writes`
     asserts `cancelled` and **must be updated** to assert `error`). Start a
     gated turn (never set the gate), drive a `Collector` to first delta,
     `await registry.aclose()`. Assert:
     - `pairs[-1][0].type == "error"` (NOT `done`)
     - `"done" not in [e.type for e,_ in pairs]`
     - `values["turn_records"][-1]["status"] == "error"`
     - `prose_of(record["parts"]) == _prose(pairs)` (prose preserved)
     - `registry.is_generating(sid) is False`
  2. **Update** the existing `test_aclose_drains_in_flight_turns_and_lands_their_writes`
     to the error semantics (it currently asserts `status == "cancelled"` —
     change to `"error"` and the terminal type to `error`). Note this in the
     completion checklist as an intentional test change (BC-15 is a behavior fix;
     the old assertion encoded the bug).
  3. Keep `test_aclose_with_a_live_turn_over_a_parked_session_drains_and_frees`
     green — but note its live-turn assertion currently expects
     `status == "cancelled"` for the aclose'd live turn (`pairs[-1][0].data
     ["status"] == "cancelled"`). **Update** that assertion too: the live turn
     drained by `aclose` now ends with `error`, so change the live-turn
     assertions to `pairs[-1][0].type == "error"` and drop the `data["status"]`
     check (error has no `status` field — it has `message`/`trace_id`). The
     parked-session half of that test (cancel-on-parked → `unparked`, frozen
     record) is unchanged.

- **Acceptance criteria:**
  - [ ] `aclose` drains active turns via `_terminate_for_shutdown` →
        `_drain_active_with_error`, terminating with `ev_error` (status="error").
  - [ ] Parked/idle sessions still route through `_unpark_if_parked`.
  - [ ] No active turn drained by shutdown produces a `done(cancelled)` event or
        a `cancelled` turn record.
  - [ ] The two existing aclose tests are updated to the error semantics and
        pass; the new dedicated test passes.

---

### BC-16 — `_parse_last_event_id` clamp ceiling is unrelated to any real seq  [LOW]

- **Files:** `api/routes/sessions.py` (`_parse_last_event_id`).

- **Problem:** The clamp accepts `0 <= n < 10_000_000`, unrelated to the buffer's
  `next_seq`. It only sanity-bounds garbage; the real defense against a foreign/
  future cursor is BC-06's per-turn relevance check in `_follow`.

- **Fix:** No behavior change — BC-06 is the real fix. Update the docstring to
  point at BC-06 so the clamp's role is honest.

  *Before:*
  ```python
  def _parse_last_event_id(raw: str | None) -> int | None:
      """Parse + clamp the ``Last-Event-ID`` header → a valid seq, or ``None``.

      A malformed, negative, or absurdly large value degrades to ``None`` (full
      replay) — never a 500. Only ``0 <= n < _MAX_EVENT_ID`` is honoured.
      """
  ```
  *After:*
  ```python
  def _parse_last_event_id(raw: str | None) -> int | None:
      """Parse + clamp the ``Last-Event-ID`` header → a valid seq, or ``None``.

      A malformed, negative, or absurdly large value degrades to ``None`` (full
      replay) — never a 500. Only ``0 <= n < _MAX_EVENT_ID`` is honoured.

      The ceiling is a sanity bound on garbage, NOT relevance: a cursor from a
      PREVIOUS turn can be small yet still foreign to the current turn's buffer.
      The real guard is server-side in ``TurnRegistry._follow`` (BC-06): a cursor
      ahead of the buffer's ``next_seq`` triggers a full replay from the head,
      never a silent skip.
      """
  ```

- **Tests to add:** none (covered by BC-06's tests). A reviewer confirms the doc
  references BC-06's mechanism.

- **Acceptance criteria:**
  - [ ] The docstring references the BC-06 server-side relevance guard.

---

### BC-17 — `v: 1` rides every SSE frame; the SSE `id:` is per-turn not global  [LOW]

- **Files:** `api/sse.py` (`encode_sse`), `domain/events.py` (`Event.v`).

- **Problem:** `encode_sse` JSON-encodes `event.model_dump()`, which includes
  `v: 1` on every frame — minor wire overhead. The substantive issue (the
  per-turn, non-global `id:`) is BC-06's relevance check, already fixed.

- **Fix:** Per master-plan §5 there is **no wire-protocol change** in this phase
  — do NOT strip `v` from the frame (a client may rely on it; changing the frame
  shape risks BC-06's "no wire change" constraint). The only change is a comment
  in `encode_sse` documenting that the `v` overhead is accepted and the cross-turn
  `id:` concern is handled server-side by BC-06.

  *Before* (the `seq` arg docstring in `encode_sse`):
  ```python
          seq:   Monotonically increasing sequence number for the ``id:`` field.
                 Clients use this for reconnect/Last-Event-ID; it must be unique
                 within a stream but need not be globally unique.
  ```
  *After:*
  ```python
          seq:   Monotonically increasing sequence number for the ``id:`` field.
                 Clients use this for reconnect/Last-Event-ID; it is unique within
                 a turn's buffer but NOT across turns. A client that persists a
                 Last-Event-ID across a turn boundary is handled safely
                 server-side (BC-06): a cursor ahead of the new turn's buffer
                 triggers a full replay, never a silent skip. The ``v:1`` field on
                 every frame is accepted wire overhead (no protocol change this
                 phase — master plan §5).
  ```

- **Tests to add:** none (documentation only; BC-06 covers the substance).

- **Acceptance criteria:**
  - [ ] `encode_sse`'s docstring documents the per-turn `id:` + the BC-06 guard;
        no frame-shape change was made.

---

### BC-18 — `start()`'s starter slot bypasses the consumer cap (off-by-one)  [LOW]

- **Files:** `app/turns.py` (`start`, `attach`).

- **Problem:** `start()` claims the first consumer slot with no cap check; the
  cap (`max_consumers_per_turn`) is enforced only on `attach`. In practice the
  starter is always the first consumer, so it can exceed the cap by exactly one —
  harmless but inconsistent.

- **Fix:** With BC-02 moving the claim into `_follow`, the starter's slot is now
  claimed on first iteration just like an attach. The cap check still lives only
  in `attach` (the starter is exempt by design — it is the turn's owner). Document
  the exemption rather than enforce a cap on the starter (enforcing it would risk
  rejecting the very POST that created the turn — wrong).

  Add a one-line comment in `start` near the `return self._follow(turn, None)`
  (already added in BC-02's after-snippet) — confirm it states the starter slot
  is uncapped by design. No additional change needed beyond BC-02.

- **Tests to add:** none beyond BC-02's. A reviewer confirms the starter is
  intentionally exempt and `attach` enforces the cap.

- **Acceptance criteria:**
  - [ ] The starter's consumer slot is documented as cap-exempt by design; the
        cap is enforced on `attach` only.

---

### BC-19 — `on_turn_complete` runs synchronously inside finalize; a blocking hook delays eviction visibility  [LOW]

- **Files:** `app/turns.py` (`_finalize`).

- **Problem:** `_finalize` does `buffer.close()` → `del self._turns` → calls the
  hook. The order is fine (close + evict before the hook), and the async hook is
  spawned non-blocking. But a *sync* `on_turn_complete` hook that blocks would
  stall finalize. The auto-titler (B4) is async + spawned, so this is latent.

- **Fix:** Document the invariant on the `on_turn_complete` attribute and in
  `_finalize` that a sync hook must not block; the eviction + buffer close
  already happen *before* the hook, so even a slow sync hook can't corrupt
  lifecycle state — it only delays the (already non-load-bearing) hook return.
  Add the doc; no behavior change.

  *Before* (the `on_turn_complete` attribute comment in `__init__`):
  ```python
          #: B4's auto-title hook seam: called (guarded) with the session_id when
          #: a turn reaches its terminal event. May be sync or async.
          self.on_turn_complete: Callable[[str], Any] | None = None
  ```
  *After:*
  ```python
          #: B4's auto-title hook seam: called (guarded) with the session_id when
          #: a turn reaches its terminal event. May be sync or async. INVARIANT
          #: (BC-19): a SYNC hook MUST NOT block — it runs inline in _finalize on
          #: the detached task AFTER the buffer is closed + the turn evicted, so a
          #: blocking sync hook can't corrupt lifecycle state but would stall the
          #: finalize coroutine. Heavy work belongs in an async hook (spawned,
          #: drained in aclose). The auto-titler is async by design.
          self.on_turn_complete: Callable[[str], Any] | None = None
  ```

- **Tests to add:** none (documentation; lifecycle ordering already correct).
  Optionally a reviewer confirms `buffer.close()` + `del self._turns` precede
  the hook call in `_finalize`.

- **Acceptance criteria:**
  - [ ] The `on_turn_complete` seam documents the BC-19 non-blocking invariant.
  - [ ] `_finalize` still closes the buffer + evicts before calling the hook.

---

### BC-20 — `derive_receipt`'s "other" bucket can underflow if a future kind joins two buckets  [LOW]

- **Files:** `app/records.py` (`derive_receipt`).

- **Problem:** `other = len(kinds) - db - web - reddit - viz` assumes disjoint
  bucket membership. With the current `StepKind` literal the buckets are disjoint
  (`db` = `db_tool|sql`, `web` = `web_search|edu_search`, `reddit`, `viz`), so
  `other >= 0`. But `StepKind` also includes `skill` and `research` (uncounted →
  fall into "other" correctly) — and if a future kind were added to two buckets,
  `other` would underflow negative and render "-1 steps".

- **Fix:** Clamp `other` to `>= 0` (cheap, defensive, KISS).

  *Before:*
  ```python
      viz = sum(1 for k in kinds if k == "viz")
      other = len(kinds) - db - web - reddit - viz
  ```
  *After:*
  ```python
      viz = sum(1 for k in kinds if k == "viz")
      # Clamp defensively (BC-20): with the current StepKind literal the buckets
      # are disjoint so this is already >= 0, but a future kind that joins two
      # buckets would underflow to a nonsense "-1 steps" — never show that.
      other = max(0, len(kinds) - db - web - reddit - viz)
  ```

- **Tests to add** (`tests/app/test_records.py`):
  1. `test_derive_receipt_other_bucket_never_negative` — call `derive_receipt`
     with steps whose kinds are all in counted buckets (e.g. two `db_tool`,
     distinct `step_id`s) and assert the receipt has no `-` / no "other" segment
     when `other` would compute to 0. Then a direct guard test: build a steps
     list where, hypothetically, `len(kinds)` is less than the bucket sum (not
     reachable via real kinds, so assert the formula's clamp by checking that a
     normal mixed list — 1 `db_tool`, 1 `web_search`, 1 `skill` — yields
     `"1 database lookup · 1 web search · 1 step"` with `other == 1`, exercising
     the `other > 0` branch correctly). The core assertion: the receipt never
     contains a negative number.
  2. Keep any existing `derive_receipt` tests in `test_records.py` green.

- **Acceptance criteria:**
  - [ ] `other` is clamped via `max(0, ...)`.
  - [ ] A receipt never renders a negative step count.

---

### BC-21 — `set_session_source_config` not idempotency-protected against rapid double-submit  [LOW]

- **Files:** `api/routes/sessions.py` (`post_message`) — sub-case of BC-12.

- **Problem:** A rapid double-POST (network retry) where the first is still
  mid-flight: the second's pre-start writes used to land, then 409. This is a
  direct sub-case of BC-12.

- **Fix:** **Fully resolved by BC-12** — moving the writes after a successful
  `start()` means the second (409'd) POST never reaches the source-config/title
  writes. No additional change. Recorded here so a reviewer maps BC-21 → BC-12's
  fix and doesn't flag it as a miss.

- **Tests to add:** none beyond BC-12's `test_409_does_not_overwrite_source_config_or_title`,
  which IS the double-submit case.

- **Acceptance criteria:**
  - [ ] BC-12's reorder is confirmed to cover the rapid double-submit case (the
        second 409'd POST writes nothing) — verified by BC-12's test.

---

## Cross-phase notes (interactions with Phase 2 / Phase 3 on shared functions)

These are the points where Phase 1's edits touch functions other phases own.
Phase 1 must leave these clean so the later extractions stay tidy.

1. **`_persist_partial` / `_persist_partial_guarded` (BC-08 here; H1/BC-09 in
   Phase 3).** Phase 1 wraps each `_persist_partial` attempt in
   `asyncio.timeout` *inside* `_persist_partial_guarded` and does NOT touch
   `_persist_partial`'s body (the record-building logic Phase 3 will extract into
   a shared `build_partial_update(...)` with `run_turn._write_failure_record`).
   When Phase 3 extracts the shared builder, the timeout wrapper stays on the
   registry's `_persist_partial_guarded` (it is registry-lifecycle concern, not
   record-shape concern). **Do not** move the timeout into `_persist_partial`
   itself — keep the I/O-bounding at the guard layer so Phase 3's pure-builder
   extraction is unaffected.

2. **The cancel/timeout/shutdown terminal trio (BC-03/BC-04/BC-15 here; BC-09
   single-owner in Phase 3).** Phase 1 leaves three near-identical
   "cancel task → await → persist → terminal → finalize" methods:
   `_cancel_active` (status="cancelled", `ev_done`), `_handle_timeout`
   (status="error", `ev_error`, no task-cancel — it's already past the timeout),
   and the new `_drain_active_with_error` (status="error", `ev_error`). Phase 1
   adds a `# Phase 3 (BC-09): fold with _cancel_active` breadcrumb above
   `_drain_active_with_error`. Phase 3 folds them into one parametrized helper
   `(status, terminal_event_factory, cancel_task: bool)`. Phase 1 must NOT
   pre-build that abstraction (YAGNI; keep the three explicit so the BC-15
   behavior change is reviewable in isolation).

3. **BC-15's `error`-on-shutdown vs BC-13 receipt fidelity (Phase 2).** BC-15
   makes a shutdown-drained turn persist `status="error"`. Phase 2's BC-13
   (receipt `result_count` default-to-0 for search steps) touches the receipt/
   step-detail path, not the turn-record status path — no conflict. The
   `derive_receipt` BC-20 clamp here and BC-13 there both touch the
   receipt-building surface but in disjoint functions (`app/records.py:
   derive_receipt` vs `app/steps.py: detail_for` / `domain/events.py`). Keep
   BC-20's change confined to `derive_receipt`.

4. **BC-06's `_follow` cursor reset (Phase 1) vs Phase 4 FE Last-Event-ID
   handling.** BC-06 is server-side only (no wire change). The FE's reconnect
   logic (Phase 4) sends `Last-Event-ID` as before; the server now safely
   full-replays a foreign cursor. No coordination needed beyond noting the FE
   may receive a from-the-head replay after a turn boundary (which it already
   tolerates — it renders from the transcript on `done`/`error`).

5. **`post_message` reorder (BC-12) vs Phase 3 route decomposition (M3).**
   Phase 3 may decompose `run_turn`/route flow; Phase 1's BC-12 reorder
   (claim-then-persist) is the correct order Phase 3 must preserve. Leave a
   `# BC-12: claim before side-effect writes` comment so Phase 3's refactor keeps
   the ordering.

---

## Phase completion checklist

- [ ] BC-01: byte-budget ring buffer + shared accumulator + setting; refund at
      finalize; never strands the buffer empty; all BC-01 tests + the existing
      fall-off tests green.
- [ ] BC-02: consumer claim moved into `_follow`; undriven-handle leak test
      green; cap still enforced.
- [ ] BC-03: `cancel()` sets `cancel_requested` synchronously; concurrent-cancel
      test proves one terminal + one persist.
- [ ] BC-04: `_drive` finally collapsed to one `cancel_requested` block;
      external-cancel-race test proves a single terminal.
- [ ] BC-05: `append` no-ops after close (included in BC-01 rewrite); standalone
      test green.
- [ ] BC-06: `_follow` resets a foreign/future cursor to a full replay;
      foreign-cursor test green; caught-up cursor still follows live.
- [ ] BC-07: `_observe` invariant documented; purity test green.
- [ ] BC-08: `persist_partial_timeout_s` setting; bounded persist; hung-DB test
      proves finalize + claim release.
- [ ] BC-10: await-free claim-window invariant documented; no lock added.
- [ ] BC-12: `post_message` claims before side-effect writes; 409/422 no-write
      test green.
- [ ] BC-15: shutdown drain terminates active turns with `error` (not
      `cancelled`); the two existing aclose tests updated + the new dedicated
      test green.
- [ ] BC-16: `_parse_last_event_id` doc references BC-06.
- [ ] BC-17: `encode_sse` doc updated; no wire change.
- [ ] BC-18: starter slot documented cap-exempt.
- [ ] BC-19: `on_turn_complete` non-blocking invariant documented.
- [ ] BC-20: `derive_receipt` clamps `other`; test green.
- [ ] BC-21: confirmed covered by BC-12.
- [ ] Cross-phase breadcrumb comments added (Phase 3 BC-09 fold; BC-12 ordering).
- [ ] Gate: `ruff check .`, `mypy .`, `pytest -m "not live_llm and not
      live_search"` (full routine suite) all green.
- [ ] Every fix above has at least one regression test; no existing
      lifecycle/honesty test was weakened (the two aclose-status assertions were
      *corrected* to the BC-15 error semantics — documented as intentional, not
      a weakening).
