# Backend Correctness Audit — Wave 1, Territory 02

**Scope:** Agent runtime & turn lifecycle (`app/turns.py`, `app/run_turn.py`,
`app/steps.py`, `app/agent_node.py`, `app/records.py`, `domain/events.py`),
the SSE protocol (`api/sse.py`), the turn registry (detach/reattach/cancel/
resume), Last-Event-ID resumption, concurrency, and the API routes (`api/`).

**Method:** Deep read + execution-path tracing of the detached-turn lifecycle,
the ring buffer, the consumer/`_follow` loop, cancel/timeout/finalize ordering,
and the route → registry → graph wiring. Read-only; no code changed.

**Date:** 2026-06-16
**Reviewer:** backend correctness pass (SRE lens)

---

## Severity summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH     | 6 |
| MEDIUM   | 8 |
| LOW      | 6 |
| **Total** | **21** |

---

## CRITICAL

### BC-01 — Unbounded `_RingBuffer` per turn: a single turn can OOM the process
**Severity:** CRITICAL
**Category:** resource exhaustion / unbounded growth
**Location:** `app/turns.py:110-129`, `app/turns.py:224`

**Evidence:**
```python
buffer = _RingBuffer(getattr(self._settings, "stream_buffer_size", 20_000))
```
```python
def __init__(self, maxsize: int) -> None:
    self._maxsize = max(1, maxsize)
    self._events: list[Event] = []
```
The ring buffer holds up to **20,000 fully-materialized `Event` objects** per
in-flight turn, by default. `max_concurrent_turns` defaults to 50
(`app/turns.py:221`). Each `delta` event carries a chunk of prose; a long
answer with native Gemini thinking summaries plus step receipts (which embed
SQL statements, search results, school lists) can make each event non-trivial.

**Why it matters:** 50 concurrent turns × 20,000 events × (event + nested dict
payloads) is a large, attacker-influenceable heap. The buffer never shrinks
below `maxsize` while the turn is live, and **every turn allocates a fresh
20k-slot buffer**. A burst of long-running turns (each one legitimately allowed
by single-flight + the 50-turn cap) can drive the process to OOM. The buffer is
sized for "never evict a delta during a normal turn" (the honesty goal — see the
fell-off-head path) but the ceiling is set per-turn, not globally. There is no
global byte budget across turns.

**Trigger:** 50 sessions each POST a prompt that produces a very long answer
(or many tool steps); hold them all open. Or one session repeatedly if the cap
is mis-set.

**Fix direction:** Cap by **bytes**, not event count, and budget *globally*
across all live turns (a shared semaphore/accumulator decremented on eviction
and on finalize). Alternatively lower the default `stream_buffer_size`
dramatically and accept that a fallen-behind consumer gets the honest
fell-off-head error (BC-07 path already exists). At minimum, document and
enforce a `max_concurrent_turns × stream_buffer_size × avg_event_bytes` ceiling
that fits the deploy's memory.

---

## HIGH

### BC-02 — `start()` claims a consumer slot synchronously but `_follow`'s decrement only runs if the generator is driven and closed → consumer-slot + (via single-flight) session leak
**Severity:** HIGH
**Category:** resource leak / async lifecycle
**Location:** `app/turns.py:233-235`, `app/turns.py:251`, `app/turns.py:463-464`

**Evidence:**
`start()`:
```python
turn.task = asyncio.create_task(self._drive(turn, source_config), ...)
turn.consumers += 1  # the starter is the first consumer (decremented in _follow)
return self._follow(turn, None)
```
`attach()`:
```python
turn.consumers += 1  # claimed synchronously here (decremented in _follow)
return self._follow(turn, last_event_id)
```
`_follow()` decrements only in its `finally`:
```python
finally:
    turn.consumers -= 1
```
A `finally` in an async generator runs when the generator is **closed**
(`aclose()` / GC). `start()`/`attach()` increment `consumers` *before* the
generator is ever iterated. The route wraps the handle in `_sse_response` →
`EventSourceResponse(_encoded())`. `_encoded` iterates `stream`, so on the
normal path it closes correctly. **But** if the response object is created and
then the request is abandoned before ASGI drives the body (client RST during
header send, an exception between `start()` and the `return`, or any path where
the `EventSourceResponse` body generator is never started and never closed),
the `_follow` generator is never closed → `consumers` is never decremented.

**Why it matters:** The per-turn consumer cap (`max_consumers_per_turn`, default
8) is reachable by leaked phantom consumers, eventually 429-ing legitimate
reattach. More subtly, the increment-before-iterate pattern is fragile: it
assumes the ASGI server *always* drives and closes the generator. Under load /
disconnect storms this assumption is the kind of thing that breaks at 3am.

**Fix direction:** Move the consumer increment *into* `_follow` (claim on first
iteration), or use an explicit try/finally bracket the route owns. Better: gate
the cap on a context-managed handle so the claim and release are symmetric and
not dependent on generator GC timing.

---

### BC-03 — `cancel()` is not single-flight against `aclose()` / concurrent cancels; `_cancel_active` can double-append a terminal and double-finalize
**Severity:** HIGH
**Category:** race condition
**Location:** `app/turns.py:254-269`, `app/turns.py:468-484`, `api/routes/me.py:109-118`

**Evidence:**
`cancel()` reads the guard and then awaits:
```python
if (turn is not None and not turn.finalized and not turn.cancel_requested
        and turn.task is not None and not turn.task.done()):
    await self._cancel_active(turn)
```
`_cancel_active` sets `cancel_requested = True` only *after* the check, and the
check→`_cancel_active`→`turn.cancel_requested = True` window contains no
`await`-free atomicity guarantee across *two separate `cancel()` calls* because
each re-reads `self._turns.get(session_id)` and the guard. Two concurrent
cancels (e.g. the `POST .../cancel` route AND `delete_session_route` →
`_cancel_and_drop_threads` → `registry.cancel`, or account-delete cancelling the
same session) both pass the guard before either sets `cancel_requested`, then
both call `task.cancel(); await task; ... buffer.append(ev_done("cancelled"));
self._finalize(turn)`.

`_finalize` is idempotent (`if turn.finalized: return`), so the *second*
`buffer.append(ev_done("cancelled"))` happens **before** the idempotent
`_finalize`, appending a **second terminal `done` event** to the buffer and a
second `_persist_partial_guarded` (a redundant `aupdate_state`).

**Why it matters:** Protocol contract violation — a stream must end with exactly
one terminal event; a consumer replaying the buffer can see two `done`
events. The second `_persist_partial` is a redundant write (cancelled status
again). Concurrent cancel is reachable: a user can hit the cancel endpoint while
a delete is in flight, or two delete endpoints (`/me/chats` and a single chat
delete) can overlap.

**Fix direction:** Set `turn.cancel_requested = True` synchronously inside
`cancel()` (under the no-await window) before awaiting `_cancel_active`, and
re-check it inside `_cancel_active`. Or guard the whole cancel with a per-turn
`asyncio.Lock`.

---

### BC-04 — `_drive`'s `finally` can append a terminal `error` *after* `_cancel_active` already appended `done(cancelled)`, on the abrupt-shutdown / external-cancel race
**Severity:** HIGH
**Category:** race condition / cancellation handling
**Location:** `app/turns.py:319-345`, `app/turns.py:468-484`

**Evidence:**
`_cancel_active`:
```python
task.cancel()
try:
    await task          # _drive's body raises CancelledError → finally runs
except asyncio.CancelledError:
    pass
...
turn.buffer.append(ev_done("cancelled"))  # appended AFTER await task returns
self._finalize(turn)
```
`_drive` finally:
```python
finally:
    if not turn.cancel_requested and not turn.terminal_appended:
        turn.terminal_appended = True
        turn.buffer.append(ev_error(_USER_SAFE_ERROR, turn.trace_id))
    if not turn.cancel_requested:
        self._finalize(turn)
```
The contract relies on `cancel_requested` being `True` when `_drive`'s finally
runs. `_cancel_active` sets `cancel_requested = True` *before* `task.cancel()`,
so on the normal cancel path the finally correctly skips. **However**, the
docstring (`turns.py:36-40`, `337-339`) explicitly contemplates "the task was
cancelled by something OTHER than our own cancel path (an abrupt shutdown
cancelling the bare task)". If the event loop / shutdown cancels the `_drive`
task directly (not via `_cancel_active`), `cancel_requested` is `False`, so the
finally appends `ev_error` and finalizes — which is the intended safety net.
But the ordering of "who cancels" is not serialized: during `aclose()`, the
registry iterates and calls `self.cancel()`, but a *parallel* loop-shutdown
cancellation of the same `_drive` task is possible (the task is a top-level
`create_task`, eligible for cancellation by the runner during shutdown). The two
paths are not mutually exclusive, and `terminal_appended`/`cancel_requested` are
plain bools mutated from two coroutines with `await` points between read and
write.

**Why it matters:** A double terminal event (one `error`, one `done`), or a
`_finalize` racing a `buffer.append` after `buffer.close()`. `append()` on a
closed buffer still mutates `self._events` and calls `_notify()` — there is no
`closed` guard in `append` (see BC-05) — so a late terminal can land after
close.

**Fix direction:** Make `append` a no-op once `closed` (BC-05), and serialize
the terminal-append decision under a per-turn lock so exactly one writer appends
the terminal and finalizes.

---

### BC-05 — `_RingBuffer.append` has no `closed` guard: events can be appended after the buffer is closed
**Severity:** HIGH
**Category:** correctness / protocol contract
**Location:** `app/turns.py:124-129`, `app/turns.py:131-133`

**Evidence:**
```python
def append(self, event: Event) -> None:
    self._events.append(event)
    if len(self._events) > self._maxsize:
        del self._events[0]
        self.base += 1
    self._notify()

def close(self) -> None:
    self.closed = True
    self._notify()
```
`close()` only flips a flag; `append()` never checks it. Any append after close
(see BC-03/BC-04 double-terminal races, or a late `_observe` from a slow
enrichment) mutates the event list and re-fires the flag. A `_follow` consumer
that already returned on `if buffer.closed: return` (`turns.py:460`) won't see
it, but a consumer mid-loop can yield a post-terminal event, and `next_seq`
advances past the terminal.

**Why it matters:** Violates "exactly one terminal event, nothing after it".
Combined with BC-03/BC-04 it's the mechanism by which double-terminals reach a
consumer.

**Fix direction:** `if self.closed: return` at the top of `append()` (and log a
warning — an append-after-close is a logic bug worth surfacing).

---

### BC-06 — Last-Event-ID replay is silently wrong when the requested seq is in the future (ahead of the buffer)
**Severity:** HIGH
**Category:** broken resume / Last-Event-ID logic
**Location:** `app/turns.py:433-462`, `api/routes/sessions.py:130-144`

**Evidence:**
`_follow`:
```python
seq = 0 if after_seq is None else after_seq + 1
while True:
    flag = buffer.flag
    if seq < buffer.base:
        ... # fell off the head — honest error
    if seq < buffer.next_seq:
        yield buffer.get(seq), seq
        seq += 1
        continue
    if buffer.closed:
        return
    await flag.wait()
```
The route clamps `Last-Event-ID` only to `0 <= n < 10_000_000`
(`_parse_last_event_id`). A client can send a `Last-Event-ID` **larger than the
buffer's current `next_seq`** (e.g. it saw seq 50 on turn A, the turn finalized
and evicted, a NEW turn started for the same session with a fresh buffer at
base 0, and the client reconnects with `Last-Event-ID: 50`). Now `seq = 51`,
`buffer.next_seq` is small (say 3). `seq < buffer.base` is false (base 0),
`seq < buffer.next_seq` is false → it goes straight to `await flag.wait()`,
blocking until *the new turn* produces 51 events, **silently skipping events
1..50 of the new turn**.

**Why it matters:** A reconnect after a turn boundary (very common: finish turn,
auto-reconnect) replays into a *different* turn's buffer and silently drops the
new turn's early events — corrupted prose, exactly the honesty failure the
fell-off-head path was built to prevent, but here it sails past undetected.
seq is per-turn-buffer, not per-session, so cross-turn Last-Event-ID is
meaningless yet accepted.

**Fix direction:** When `after_seq + 1 > buffer.next_seq` at attach time, treat
it as a stale/foreign cursor → full replay from base (or the honest
fell-behind error). The buffer should also expose a turn identity so the route
can detect "your cursor is from a previous turn" and full-replay. Simplest:
clamp `seq = min(seq, buffer.next_seq)` is wrong (skips); instead if
`seq > buffer.next_seq` at first check, reset `seq = buffer.base`.

---

### BC-07 — `_observe` enrichment runs on the `_drive` task and can stall the entire turn's buffer fill (and trip the watchdog) on a slow `enrich_usage_event`
**Severity:** HIGH (operational)
**Category:** blocking / latency coupling
**Location:** `app/turns.py:298-316`, `app/turns.py:347-382`

**Evidence:**
```python
async for event in stream:
    turn.buffer.append(self._observe(turn, event))
```
`_observe` calls `enrich_usage_event(...)` synchronously for `usage` events.
The buffer fill loop is the single producer; any per-event work in `_observe`
serializes the stream. `enrich_usage_event` is wrapped in try/except (good), but
if it does real CPU work (cost table lookup, formatting) on a large usage
payload it adds latency to the producer. More importantly, the *entire*
`run_turn` async generator is consumed in this one loop under
`asyncio.timeout(timeout_s)`; nothing yields the buffer to consumers faster than
this loop runs.

**Why it matters:** This is a coupling/operational hazard rather than a crash:
the consumer-visible latency and the watchdog budget both depend on `_observe`
staying cheap. It is currently cheap, but the design puts enrichment on the
critical producer path with no isolation. Flagging so a future heavier
enrichment doesn't silently regress streaming latency.

**Fix direction:** Keep `_observe` strictly O(1)/pure; if enrichment ever grows,
move it off the fill loop (enrich lazily at yield, cached). Document the
"`_observe` must stay cheap" invariant in code.

---

## MEDIUM

### BC-08 — Watchdog timeout terminal does not `_finalize` directly; relies on `_drive` finally — but a consumer that already passed `buffer.closed` won't, and there's a window where `_turns` still holds the session
**Severity:** MEDIUM
**Category:** lifecycle / single-flight
**Location:** `app/turns.py:317-318`, `app/turns.py:486-500`, `app/turns.py:340-344`

**Evidence:** `_handle_timeout` appends the error and sets `terminal_appended`
but does not finalize; finalize happens in `_drive`'s finally. Between
`_handle_timeout` returning and the finally running there are no awaits, so it's
effectively atomic — OK. The real note: a timed-out turn's partial persistence
(`_persist_partial_guarded`) runs *inside the `asyncio.timeout` block having
already expired*? No — `_handle_timeout` runs in the `except TimeoutError`
handler, outside the `async with asyncio.timeout`. Good. But
`_persist_partial_guarded` does up to two `aupdate_state` calls with no timeout
of their own; if the DB is the reason the turn timed out, these can hang,
holding the session claim in `self._turns` indefinitely (single-flight stays
locked, 409 forever for that session).

**Why it matters:** A wedged DB turns a timeout into a permanent per-session
lockout, because finalize (which `del self._turns[session_id]`) is gated behind
the partial-persist awaits.

**Fix direction:** Wrap `_persist_partial` calls in their own short
`asyncio.timeout`; finalize (evict the claim) even if persistence times out.

---

### BC-09 — `_persist_partial` / `_write_failure_record` duplicate logic that must "KEEP IN SYNC" by hand — divergence risk on the partial-record shape
**Severity:** MEDIUM
**Category:** maintainability / correctness drift
**Location:** `app/turns.py:528-578`, `app/run_turn.py:117-175`

**Evidence:** `turns.py:537-541` explicitly says *"KEEP IN SYNC with
`app.run_turn._write_failure_record`"*. Two functions independently rebuild the
partial `ModelResponse` + the turn record + the empty-partial rule + the offset
fallback, from different vantages (wire events vs in-process emissions). They
already differ subtly: `_write_failure_record` has a `fallback_messages`
restore path (`run_turn.py:149-153`) that `_persist_partial` lacks; the offset
fallbacks differ (`max(len(messages)-1,0)` vs `_partial_anchor`).

**Why it matters:** A future change to the record shape or the empty-partial
rule landing in one but not the other corrupts transcripts on the path that
wasn't updated. This is a latent honesty bug (the transcript is the honesty
surface).

**Fix direction:** Extract one `build_partial_update(messages, records, emissions,
ids, status, ...)` helper both call; the only difference (emission source) is an
argument.

---

### BC-10 — `is_generating` / single-flight key is the session, but `_turns` is read without any lock from the route thread vs the detached `_finalize` mutation
**Severity:** MEDIUM
**Category:** race condition (benign-ish under GIL/asyncio but fragile)
**Location:** `app/turns.py:190-193`, `app/turns.py:215-226`, `app/turns.py:384-391`

**Evidence:** `_finalize` does `del self._turns[turn.session_id]` from the
detached task; `start()`/`is_generating()`/`attach()` read/write `self._turns`
from the request task. asyncio is single-threaded so dict ops are atomic
between awaits, and `start()`'s check-and-claim is await-free (correctly noted).
But `list_sessions_route` calls `registry.is_generating(row["session_id"])`
inside a list comprehension (`api/routes/sessions.py:415-424`) — a read that can
observe a turn mid-finalize on a different scheduling boundary. Functionally
this only affects the "generating dot" accuracy, so it's MEDIUM.

**Why it matters:** Mostly cosmetic (a stale generating dot), but it documents
that `_turns` mutation isn't centralized. The bigger risk is future code adding
an `await` inside the start check-and-claim window, silently breaking
single-flight.

**Fix direction:** Centralize all `_turns` mutation behind small synchronous
helpers and add a code comment/assert that the claim window stays await-free.

---

### BC-11 — `run_turn` calls `graph.aupdate_state(config, {"turn_ids": {..., "resume_text": user_text}})` on the resume path with no guard; a failure here aborts the whole turn before any user-visible work, but the parked record is left mutated-or-not ambiguously
**Severity:** MEDIUM
**Category:** error handling / state consistency
**Location:** `app/run_turn.py:243-258`

**Evidence:**
```python
await graph.aupdate_state(config, {"turn_ids": {**turn_ids, "resume_text": user_text}})
graph_input = Command(resume=user_text)
```
This `aupdate_state` is inside the main try, so a failure jumps to the generic
exception handler → `_write_failure_record` + `ev_error`. But the resume hasn't
run; the parked clarify record is still `awaiting_input`. `_write_failure_record`
then appends an *error* record. Now the thread has a parked record followed by
an error record — the next message's parked-detection
(`run_turn.py:209-213`, last record `awaiting_input`) sees the error record last
and treats the thread as NOT parked, orphaning the clarify.

**Why it matters:** A transient DB blip on the resume `aupdate_state` can
silently strand a pending clarify (the student answered, got an error, and now
the agent has forgotten it was asking).

**Fix direction:** On the resume path, if the pre-run `aupdate_state` fails,
do not write an error record that follows the parked record (or write a
*replacement* parked record, not an append). The parked state must survive a
failed resume so the student can retry the answer.

---

### BC-12 — Default-title write and source-config write in `post_message` happen BEFORE `registry.start()`, so they persist even when `start()` rejects with 409/503/422
**Severity:** MEDIUM
**Category:** ordering / side-effect leak
**Location:** `api/routes/sessions.py:235-265`

**Evidence:**
```python
if body.source_config is not None:
    await set_session_source_config(pool, sid, body.source_config.model_dump(...))
if row.get("title") is None:
    await set_session_title(pool, sid, default_title(body.text, ...))
try:
    stream = await _registry(request).start(...)
except StreamActive:
    return _error_json(409, ...)
```
If a turn is already streaming (409), or capacity is hit (503), or the edit
target is invalid (422), the session's `source_config` has already been
overwritten and the title has already been set from *this rejected* message.

**Why it matters:** A 409 (double-submit, very common with SSE retries) mutates
the stored source-config to the second request's config and stamps a title from
a message that never ran. Sticky source-config (PRD story 10) is now wrong; the
chat is titled from a rejected prompt.

**Fix direction:** Move the title/source-config writes to *after* a successful
`start()` claim (or make them part of the registry's start flow under the
single-flight claim).

---

### BC-13 — `ev_step` mutates the dict returned by `step.model_dump()` and `EmissionRouter._emit_step` re-uses `ev_step(step).data` for BOTH the wire and the persisted record — fine, but `data["detail"]` filtering drops `duration_ms=0` and any falsy-but-meaningful value? No — it drops `None` only; OK. The real issue: `result_count`/`row_count` of `0` survive (good), but `_domains_of`/`sources` empty→None path means a successful search with zero results shows no "0 results" receipt count when results key is absent
**Severity:** MEDIUM
**Category:** correctness (receipt fidelity)
**Location:** `domain/events.py:175-189`, `app/steps.py:161-166`

**Evidence:** In `detail_for` for search kinds:
```python
results = content.get("results") if isinstance(content, dict) else None
if isinstance(results, list):
    kwargs["result_count"] = len(results)
```
If a search returns `{"error": ...}` (Tavily's no-raise error shape) it's
already routed to `status:error` (good). But if it returns a dict *without* a
`results` key on success (shape drift), `result_count` is never set and the
receipt silently omits the count. Combined with `ev_step` dropping `None`
fields, the student sees a completed search step with no "N results" — an
honesty gap (looks like it found something it didn't).

**Why it matters:** Minor honesty fidelity issue on a search-result-shape change.

**Fix direction:** Default `result_count = 0` for search kinds when the success
content has no `results` list, so "0 results" is shown explicitly rather than
omitted.

---

### BC-14 — `_unpark_if_parked` and `_rewrite_history` use `getattr(snapshot, "tasks", None)` for interrupt detection but the parked-record path and the interrupt path can disagree, double-clearing
**Severity:** MEDIUM
**Category:** state consistency / resume
**Location:** `app/turns.py:580-619`, `app/turns.py:623-653`

**Evidence:** Both functions detect "parked" via *either* the last record being
`awaiting_input` *or* `snapshot.tasks[*].interrupts`. On cancel-on-parked
(`_unpark_if_parked`), when a record exists it freezes it to `cancelled` and
calls `aupdate_state(..., as_node=_AGENT_NODE)`. If both the record says parked
AND interrupts are present (a half-written B1b parked state), the function
freezes the record but the `as_node` update is what actually clears interrupts —
if the `aupdate_state` partially applies (record frozen channel committed,
interrupt-clear not), the next turn sees a `cancelled` last record (not parked →
new turn) but a live interrupt still in `snapshot.tasks`, which the *run_turn*
parked-detection OR-clause (`run_turn.py:214`) would re-trip → resume path with
no parked record. Edge, but reachable on a partial write.

**Why it matters:** A torn write between the record channel and the interrupt
state desyncs the two parked signals, and the OR-detection means the stale one
wins.

**Fix direction:** Make the interrupt clear and the record freeze a single
atomic `aupdate_state` (they already share one call — verify channels commit
together) and prefer the record as the *single* source of truth (drop the OR on
the interrupt fallback once B1b is the only writer, per the docstring's own
"pre-B1b fallback" note).

---

### BC-15 — `aclose()` drains by calling `cancel()` on each session, but a turn that is *parked* (idle task, interrupt pending) is "unparked" on shutdown, mutating state and clearing the student's pending clarify
**Severity:** MEDIUM
**Category:** shutdown behavior / data correctness
**Location:** `app/turns.py:271-294`, `app/turns.py:254-269`

**Evidence:** `aclose()` iterates `list(self._turns)` and calls `self.cancel()`.
But `_turns` only holds *in-flight* turns (a parked turn has finalized and been
evicted — `_finalize` runs on `done(awaiting_input)`? No: the parked path in
`run_turn` returns after `ev_done("awaiting_input")`, the `_drive` loop ends
normally, `_drive` finally finalizes and evicts). So a parked turn is NOT in
`_turns` at shutdown — `aclose` won't touch it. Good for parked. The note is the
inverse: `aclose` → `cancel` → for an active turn does the *full* cancel
(persist partial + `done(cancelled)`). On a clean redeploy this turns every
in-flight answer into a "cancelled" turn record even though the student didn't
press stop — the same thing the watchdog deliberately avoids (it uses `error`,
not `cancelled`, "the student didn't press stop"). Shutdown drain mislabels.

**Why it matters:** Transcript shows `cancelled` for turns killed by a deploy,
not by the user — a small honesty/UX inaccuracy and confusing for debugging
("why did the user cancel 30 turns at 02:00?" — they didn't, it was a deploy).

**Fix direction:** Give `aclose` a distinct drain path that persists the partial
with `status="error"` (server-side termination), not `cancelled`.

---

## LOW

### BC-16 — `_parse_last_event_id` accepts up to 10,000,000 but the buffer maxsize default is 20,000 — the clamp ceiling is unrelated to any real seq and just defers the BC-06 bug
**Severity:** LOW
**Category:** input validation
**Location:** `api/routes/sessions.py:127-144`
The ceiling is arbitrary; see BC-06 for the real fix (per-turn relevance check).

### BC-17 — `encode_sse` JSON-encodes `event.model_dump()` which includes `v: 1` on every frame — wire overhead, and the SSE `id:` is per-turn not globally unique (documented), but a client persisting Last-Event-ID across turns will misbehave (BC-06)
**Severity:** LOW
**Category:** protocol / efficiency
**Location:** `api/sse.py:50-55`, `domain/events.py:31`
Minor: `v` could ride `meta` only. The cross-turn id collision is the BC-06
substance.

### BC-18 — `TooManyConsumers` increments are checked with `>=` but the starter's slot in `start()` is added unconditionally with no cap check, so `start` can exceed `max_consumers_per_turn` by one
**Severity:** LOW
**Category:** off-by-one / cap consistency
**Location:** `app/turns.py:234`, `app/turns.py:248-251`
`start()` does `turn.consumers += 1` with no cap check (it's the first
consumer, so fine in practice). Just note the cap is enforced only on `attach`.

### BC-19 — `_finalize` fires `on_turn_complete` synchronously inside the detached task; a sync hook that blocks (or a coroutine that's slow) delays buffer close visibility ordering relative to eviction
**Severity:** LOW
**Category:** lifecycle ordering
**Location:** `app/turns.py:384-401`
`_finalize` does `buffer.close()` then `del self._turns` then calls the hook.
Order is fine (close before hook). The auto-titler is async and spawned
(non-blocking). A *sync* hook would block finalize. Document that
`on_turn_complete` must not block.

### BC-20 — `derive_receipt` "other" bucket can go negative if a step kind is one of the counted-but-double-counted sets — currently safe, but `other = len(kinds) - db - web - reddit - viz` assumes disjoint membership
**Severity:** LOW
**Category:** correctness (defensive)
**Location:** `app/records.py:89-104`
`db` counts `db_tool`+`sql`, `web` counts `web_search`+`edu_search`. The buckets
are disjoint by the current `StepKind` literal, so `other >= 0`. If a future
kind is added to two buckets, `other` underflows to negative and renders
"-1 steps". Add `other = max(0, ...)`.

### BC-21 — `post_message` validates `text` max_length=4000 but `default_title`/turn proceed before auth-scoped rate-limit refund; a 429 from `message_rate_limit` runs as a dependency *before* the body writes (good) — but `set_session_source_config` is not idempotency-protected against rapid double-submit
**Severity:** LOW
**Category:** idempotency
**Location:** `api/routes/sessions.py:205-241`
Rapid double POST (network retry) where the first is still mid-flight: the
second's pre-start writes (BC-12) land, then 409. Sub-case of BC-12; recorded
for completeness.

---

## Cross-cutting observations

- The lifecycle is **well-documented and clearly reasoned** — the docstrings in
  `turns.py` and `run_turn.py` show the design intent (single-flight, the
  empty-partial rule, the honesty terminal). Most findings are *races at the
  edges of an otherwise careful design* (concurrent cancel, append-after-close,
  cross-turn Last-Event-ID), not gross errors.
- The biggest structural risk is **BC-01** (memory) — it's the one that bites a
  real deploy under load without any adversary, just long answers.
- The **two-writer "keep in sync"** pattern (BC-09) and the **OR-based parked
  detection** (BC-14) are the maintainability traps most likely to spawn a
  future honesty bug.
- Several pre-start side-effect writes in the route (BC-12) violate
  "claim first, mutate after" and are cheap to fix.
