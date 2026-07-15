"""The turn registry (MVP2 B2 — ship-plan §B2, §0.1 G3/G4/G5; ADR 0022).

One :class:`TurnRegistry` per process owns the turn lifecycle. A turn is a
**detached** asyncio task wrapping :func:`app.run_turn.run_turn` — it survives
client disconnect; any number of consumers attach to its per-turn ring buffer
by index and all see the identical event sequence (the SSE ``id:`` seq is
buffer-owned, so Last-Event-ID replay is consistent across consumers).

The registry owns what the route owned in MVP1 (the route is a dumb caller):

- **seq stamping** — the ring buffer assigns the per-turn seq;
- **usage enrichment** — :func:`app.usage.enrich_usage_event` runs on the
  buffer-fill path, so a reattaching consumer sees the SAME enriched event the
  first consumer saw (route-side enrichment would fork the streams);
- **the after-commit error fallback** — a crash after the stream started still
  ends the protocol with a terminal ``error`` event;
- **the `turn_complete` log** — fields unchanged, plus ``user_id`` (None until
  B3 wires auth).

Lifecycle semantics (G3/G4/G5, all decided in the ship plan):

- ``start`` — single-flight per session (active turn → :class:`StreamActive`
  → the route maps 409). ``replace_message_id`` set → the G3 history rewrite
  runs FIRST (under the held claim), then the new text runs as a normal turn.
- watchdog — ``agent_turn_timeout_s`` exceeded → terminate with ``error`` (never
  ``done(cancelled)`` — the student didn't press stop), partial persisted.
- ``cancel`` — active: await the task's CancelledError propagation, THEN one
  ``aupdate_state`` (partial ``ModelResponse`` if prose streamed — the
  empty-partial rule — + the partial turn record + the accumulated source
  markers), then a single-shot ``done(cancelled)``; idle: no-op; parked:
  unpark (clear the interrupt via ``as_node="agent"`` — spike-1-proven — and
  freeze the clarify record unanswered).
- buffer falls off the head → the consumer is terminated with an ``error``
  event (silently skipped deltas = corrupted prose = an honesty bug).
- buffer + bookkeeping evicted at the terminal event; attach after eviction →
  :class:`NoActiveTurn` → the route returns 204 → the client falls back to
  the transcript (complete per G2).
- ``aclose`` drains in-flight turns (their final state writes land) — wire it
  BEFORE ``Runtime.aclose()`` so the writes never hit a closed pool.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Sequence
from contextlib import aclosing
from dataclasses import dataclass, field
from typing import Any, Literal, cast
from uuid import uuid4

from app.parked_sources import ParkedSourceStore
from app.records import Emission, FinalEmissionDeduper, TurnStatus
from app.run_handle import RunHandle, SteeringMessage
from app.run_turn import _USER_SAFE_ERROR, run_turn
from app.skills import SelectedSkillValidationError, validate_selected_skills
from app.sources import SourceRegistry
from app.turn_persistence import (
    AGENT_NODE,
    build_terminal_update,
    is_parked,
    parked_record,
    resolve_offset,
)
from app.usage import enrich_usage_event, log_turn_complete
from domain.events import Event, ev_done, ev_error, ev_user_message
from domain.specs import SourceConfig

logger = logging.getLogger(__name__)

_USER_SAFE_TIMEOUT = "This took too long on our side — please try asking again."
_USER_SAFE_FELL_BEHIND = (
    "Your connection fell behind the live answer — please reload to see the full response."
)

#: Flat per-event overhead added to the JSON byte estimate (BC-01) — covers
#: the Event wrapper, the list slot, and dict/list object headers.
_EVENT_OVERHEAD_BYTES = 256

CancelOutcome = Literal["cancelled", "unparked", "idle"]


class StreamActive(Exception):
    """A turn is already streaming for this session (route: 409)."""


class TooManyTurns(Exception):
    """The process-wide concurrent-turn cap is reached (route: 503)."""


class TooManyConsumers(Exception):
    """The per-turn consumer cap is reached for this turn (route: 429)."""


class NoActiveTurn(Exception):
    """No in-flight turn to attach to (route: 204 → transcript fallback)."""


class InvalidEditTarget(Exception):
    """``replace_message_id`` is not an editable user message (route: 422).

    Raised for: id not found in the turn records (incl. every pre-MVP2 turn —
    they have no ``user_message_id``), the synthesized clarify-answer bubble
    (detected via the record's ``synthesized_answer`` flag, never id-absence),
    and a record whose ``messages_offset`` anchor is corrupt (slicing on a bad
    anchor would corrupt the thread — degrade honestly instead).
    """


class InvalidSelectedSkills(Exception):
    """Explicit skills are invalid for this turn or clarify continuation."""


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


@dataclass
class _Turn:
    """Bookkeeping for one in-flight turn."""

    session_id: str
    user_text: str
    user_id: str | None
    buffer: _RingBuffer
    selected_skills: tuple[str, ...] = ()
    selected_skills_inherited: bool = False
    task: asyncio.Task[None] | None = None
    trace_id: str = ""
    ids: dict[str, Any] | None = None  # {message_id, user_message_id} from meta
    emissions: list[Emission] = field(default_factory=list)
    final_emissions: FinalEmissionDeduper = field(default_factory=FinalEmissionDeduper)
    last_usage: dict[str, Any] | None = None
    cancel_requested: bool = False
    finalized: bool = False
    terminal_appended: bool = False  # a done/error event reached the buffer
    consumers: int = 0  # currently-attached streams (per-turn consumer cap)
    run_handle: RunHandle | None = None


class TurnRegistry:
    """Owns every in-flight turn: single-flight, buffers, cancel, rewrite."""

    def __init__(
        self,
        *,
        deps: Any,
        graph: Any,
        settings: Any,
        run_turn_fn: Callable[..., AsyncIterator[Event]] | None = None,
    ) -> None:
        self._deps = deps
        self._graph = graph
        self._settings = settings
        self._run_turn = run_turn_fn or run_turn
        self._parked_sources = getattr(deps, "parked_sources", ParkedSourceStore())
        self._turns: dict[str, _Turn] = {}
        #: Process-wide byte budget shared across every live ring buffer
        #: (BC-01). Incremented on append, decremented on eviction and at
        #: finalize. A new event that would exceed the budget triggers
        #: head-eviction on the appending buffer (oldest-first) until it fits;
        #: a consumer that falls off the head is terminated honestly (BC-05).
        self._buffer_bytes_budget: int = settings.stream_buffer_bytes
        self._buffer_bytes_used: int = 0
        #: Tracked fire-and-forget hook tasks (the async ``on_turn_complete``
        #: path) — drained in ``aclose`` so a shutdown never abandons one
        #: against a closing pool.
        self._hook_tasks: set[asyncio.Task[None]] = set()
        #: B4's auto-title hook seam: called (guarded) with the session_id when
        #: a turn reaches its terminal event. May be sync or async. INVARIANT
        #: (BC-19): a SYNC hook MUST NOT block — it runs inline in _finalize on
        #: the detached task AFTER the buffer is closed + the turn evicted, so a
        #: blocking sync hook can't corrupt lifecycle state but would stall the
        #: finalize coroutine. Heavy work belongs in an async hook (spawned,
        #: drained in aclose). The auto-titler is async by design.
        self.on_turn_complete: Callable[[str], Any] | None = None

    # -- public surface ------------------------------------------------------

    def is_generating(self, session_id: str) -> bool:
        """True while a turn is in flight for this session (B4's list dot)."""
        turn = self._turns.get(session_id)
        return turn is not None and not turn.finalized

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

    async def start(
        self,
        session_id: str,
        text: str,
        source_config: SourceConfig | None = None,
        *,
        user_id: str | None = None,
        replace_message_id: str | None = None,
        selected_skills: Sequence[str] = (),
    ) -> AsyncIterator[tuple[Event, int]]:
        """Claim the session, spawn the detached turn, return an attach handle.

        The single-flight check-and-claim is synchronous (no ``await`` between
        check and claim — atomic under asyncio's cooperative scheduling). The
        G3 history rewrite runs under the held claim, BEFORE the spawn; a
        rewrite failure releases the claim and propagates.

        The returned handle is bound to the turn's buffer object directly (not
        a registry lookup), so the starter always replays from seq 0 even if
        the turn finishes before the first read.
        """
        # --- single-flight claim window: NO `await` from here through the
        # `self._turns[session_id] = turn` assignment below (BC-10). asyncio's
        # cooperative scheduling makes this check-and-claim atomic only because
        # nothing yields inside it — adding an await here would let two POSTs
        # both pass the check and double-claim the session. The rewrite-history
        # await is AFTER the claim (the claim is held across it), which is
        # correct: the claim is released in the `except BaseException` below if
        # the rewrite fails.
        try:
            selected = tuple(validate_selected_skills(selected_skills))
        except SelectedSkillValidationError as exc:
            raise InvalidSelectedSkills from exc
        if session_id in self._turns:
            raise StreamActive(session_id)
        # The global backstop: a process-wide ceiling on detached turns so an
        # abusive fan-out can't exhaust memory (single-flight already caps it
        # per session; this caps the whole process). Checked under the same
        # synchronous window as the claim — no await between check and claim.
        max_turns = self._settings.max_concurrent_turns
        if len(self._turns) >= max_turns:
            raise TooManyTurns(session_id)
        buffer = _RingBuffer(
            self._settings.agent_stream_buffer_size,
            on_charge=self._charge_bytes,
            on_refund=self._refund_bytes,
        )
        turn = _Turn(
            session_id=session_id,
            user_text=text,
            user_id=user_id,
            selected_skills=selected,
            buffer=buffer,
        )
        handle_store = getattr(self._deps, "run_handles", None)
        if handle_store is not None:
            turn.run_handle = handle_store.register(session_id)
        self._turns[session_id] = turn  # the claim — released at the terminal
        try:
            # Inspect a parked clarify before a history rewrite can remove the
            # record that owns its original selection. This also ensures a
            # non-empty answer request is rejected under the held claim.
            (
                turn.selected_skills,
                turn.selected_skills_inherited,
            ) = await self._selected_skills_for_start(session_id, selected)
            if replace_message_id is not None:
                await self._rewrite_history(session_id, replace_message_id)
        except BaseException:
            self._turns.pop(session_id, None)
            if handle_store is not None and turn.run_handle is not None:
                handle_store.unregister(session_id, turn.run_handle)
            raise
        turn.task = asyncio.create_task(self._drive(turn, source_config), name=f"turn-{session_id}")
        # The starter's consumer slot is claimed on the generator's FIRST
        # iteration (inside _follow), not here — a handle that is created but
        # never driven (client RST before ASGI starts the body) must not leak
        # a slot (BC-02). Release is symmetric in _follow's finally. The starter
        # slot is uncapped by design (BC-18): the cap is enforced on attach only,
        # never on the POST that created the turn.
        return self._follow(turn, None)

    def attach(
        self, session_id: str, last_event_id: int | None = None
    ) -> AsyncIterator[tuple[Event, int]]:
        """Attach to the in-flight turn: replay seq > ``last_event_id``, then live.

        ``last_event_id=None`` replays from seq 0. No active turn (idle, or
        evicted at terminal) → :class:`NoActiveTurn`.
        """
        turn = self._turns.get(session_id)
        if turn is None:
            raise NoActiveTurn(session_id)
        max_consumers = self._settings.max_consumers_per_turn
        if turn.consumers >= max_consumers:
            raise TooManyConsumers(session_id)
        # The cap is checked here (reject before handing out a handle), but the
        # increment happens on _follow's first iteration so an undriven handle
        # never leaks a slot (BC-02). Symmetric with the release in finally.
        return self._follow(turn, last_event_id)

    def steer(self, session_id: str, text: str) -> str:
        """Queue a mid-run user message and broadcast the immediate ack.

        This only acknowledges and buffers. The agent node is the sole owner of
        injecting queued text into PydanticAI via ``run.enqueue``.
        """
        turn = self._turns.get(session_id)
        if not self._is_steerable(turn):
            raise NoActiveTurn(session_id)
        user_message_id = str(uuid4())
        message = SteeringMessage(user_message_id=user_message_id, text=text)
        assert turn is not None
        assert turn.run_handle is not None
        turn.run_handle.queue_steer(message)
        event = ev_user_message(text, user_message_id, injected=False)
        observed = self._observe(turn, event)
        if observed is not None:
            turn.buffer.append(observed)
        return user_message_id

    @staticmethod
    def _is_steerable(turn: _Turn | None) -> bool:
        return (
            turn is not None
            and not turn.finalized
            and not turn.terminal_appended
            and not turn.cancel_requested
            and turn.run_handle is not None
            and turn.task is not None
            and not turn.task.done()
        )

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

    async def _selected_skills_for_start(
        self, session_id: str, selected_skills: tuple[str, ...]
    ) -> tuple[tuple[str, ...], bool]:
        """Resolve a parked clarify's authoritative original selection.

        This runs only after the registry has claimed the session. A clarify
        answer may not add a workflow midway through the parked turn; an empty
        request inherits the original record's validated names.
        """
        config = {"configurable": {"thread_id": session_id}}
        snapshot = await self._graph.aget_state(config)
        values = dict(snapshot.values) if snapshot else {}
        parked = parked_record(list(values.get("turn_records") or []))
        if parked is None:
            return selected_skills, False
        if selected_skills:
            raise InvalidSelectedSkills("clarify answers cannot select skills")
        return _record_selected_skills(parked), True

    # -- the detached task ----------------------------------------------------

    async def _drive(self, turn: _Turn, source_config: SourceConfig | None) -> None:
        start_mono = time.monotonic()
        timeout_s = self._settings.agent_turn_timeout_s
        handle_store = getattr(self._deps, "run_handles", None)
        try:
            try:
                async with asyncio.timeout(timeout_s):
                    run_kwargs: dict[str, Any] = {
                        "deps": self._deps,
                        "graph": self._graph,
                        "user_id": turn.user_id,
                        "selected_skills": turn.selected_skills,
                    }
                    if turn.selected_skills_inherited:
                        run_kwargs["selected_skills_inherited"] = True
                    events = cast(
                        "AsyncGenerator[Event, None]",
                        self._run_turn(
                            turn.session_id,
                            turn.user_text,
                            source_config,
                            **run_kwargs,
                        ),
                    )
                    async with aclosing(events) as stream:
                        async for event in stream:
                            observed = self._observe(turn, event)
                            if observed is not None:
                                turn.buffer.append(observed)
            except TimeoutError:
                await self._handle_timeout(turn, timeout_s)
            except asyncio.CancelledError:
                raise  # cancel() owns persistence + the single-shot terminal
            except Exception:
                # The after-commit fallback: run_turn never raises by contract,
                # so this is enrichment/buffering — the consumer already holds a
                # committed 200; end the protocol cleanly with a terminal error.
                logger.exception(
                    "turn task failed after stream start (session_id=%s, trace_id=%s)",
                    turn.session_id,
                    turn.trace_id,
                )
                turn.terminal_appended = True
                turn.buffer.append(ev_error(_USER_SAFE_ERROR, turn.trace_id))
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
            if handle_store is not None and turn.run_handle is not None:
                handle_store.unregister(turn.session_id, turn.run_handle)
            self._log_complete(turn, start_mono)

    def _observe(self, turn: _Turn, event: Event) -> Event | None:
        """Track identity/emissions/usage from the stream; enrich usage events.

        INVARIANT (BC-07): this runs on the SINGLE producer loop in ``_drive``
        — it is the only thing between the model stream and the consumer-
        visible buffer. It MUST stay O(1) per event and do no I/O / no awaits.
        ``enrich_usage_event`` (the one non-trivial call) runs once per turn
        (usage is terminal-ish) and is guarded. If any enrichment ever grows
        heavy or needs I/O, move it OFF this loop (enrich lazily at yield,
        cached) — never block the producer. Do not add per-event work here.
        """
        kind = event.type
        if kind in ("done", "error"):
            turn.terminal_appended = True
        if kind == "meta":
            turn.trace_id = str(event.data.get("trace_id") or "")
            turn.ids = {
                "message_id": event.data.get("message_id"),
                "user_message_id": event.data.get("user_message_id"),
            }
        elif kind == "delta":
            turn.emissions.append(("delta", event.data["text"]))
        elif kind == "thinking":
            turn.emissions.append(("thinking", event.data["text"]))
        elif kind == "narration":
            turn.emissions.append(("narration", event.data["text"]))
        elif kind == "user_message":
            turn.emissions.append(("user", dict(event.data)))
        elif kind == "step":
            turn.emissions.append(("step", event.data))
        elif kind == "viz":
            if not turn.final_emissions.keep(kind, event.data):
                return None
            turn.emissions.append(("viz", event.data))
        elif kind == "usage":
            try:
                event = enrich_usage_event(
                    event, self._settings.model_counselor, self._settings
                )
            except Exception:
                # A malformed usage payload must NOT sink an already-correct
                # turn with a false error (the student saw a good answer). Log
                # it, pass the raw usage event through, still record last_usage.
                logger.exception(
                    "usage enrichment failed — passing the raw usage event through "
                    "(session_id=%s, trace_id=%s)",
                    turn.session_id,
                    turn.trace_id,
                )
            turn.last_usage = dict(event.data)
        return event

    def _finalize(self, turn: _Turn) -> None:
        """Terminal: close the buffer, evict the bookkeeping, fire the hook."""
        if turn.finalized:
            return
        turn.finalized = True
        turn.buffer.close()
        turn.buffer.drop_all()  # BC-01: return this turn's bytes to the budget
        if self._turns.get(turn.session_id) is turn:
            del self._turns[turn.session_id]
        hook = self.on_turn_complete
        if hook is None:
            return
        try:
            result = hook(turn.session_id)
        except Exception:
            logger.exception("on_turn_complete hook raised (session_id=%s)", turn.session_id)
            return
        if asyncio.iscoroutine(result):
            self._spawn_hook_task(result, turn.session_id)

    def _spawn_hook_task(self, coro: Any, session_id: str) -> None:
        """Track an async ``on_turn_complete`` task so ``aclose`` can drain it —
        an untracked fire-and-forget could hit a closing pool and lose its
        exception. The guard coroutine swallows+logs so a hook failure is never
        a silent crash; the set keeps a strong ref (GC would else drop it)."""

        async def _guarded() -> None:
            try:
                await coro
            except Exception:
                logger.exception("on_turn_complete hook task raised (session_id=%s)", session_id)

        task = asyncio.create_task(_guarded(), name=f"on-turn-complete-{session_id}")
        self._hook_tasks.add(task)
        task.add_done_callback(self._hook_tasks.discard)

    def _log_complete(self, turn: _Turn, start_mono: float) -> None:
        usage = turn.last_usage or {}
        log_turn_complete(
            logger,
            session_id=turn.session_id,
            trace_id=turn.trace_id,
            usage=usage,
            duration_ms=int((time.monotonic() - start_mono) * 1000),
            est_cost_usd=usage.get("est_cost_usd"),
            user_id=turn.user_id,
        )

    # -- consumers -------------------------------------------------------------

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
                    # Fell off the head: skipped deltas would corrupt the prose the
                    # student reads — terminate honestly, never drop silently. The
                    # error carries ``buffer.base - 1`` as its seq so a reconnecting
                    # client's Last-Event-ID cleanly says "everything up to here is
                    # gone → fall back to the transcript", not the stale position.
                    logger.error(
                        "consumer fell off the buffer head (session_id=%s, seq=%d, base=%d)",
                        turn.session_id,
                        seq,
                        buffer.base,
                    )
                    yield ev_error(_USER_SAFE_FELL_BEHIND, turn.trace_id), buffer.base - 1
                    return
                if seq < buffer.next_seq:
                    yield buffer.get(seq), seq
                    seq += 1
                    continue
                if buffer.closed:
                    return
                await flag.wait()
        finally:
            turn.consumers -= 1

    # -- cancel / watchdog (G5) -------------------------------------------------

    async def _cancel_active(self, turn: _Turn) -> None:
        """Cancel the task, await propagation, persist the partial, terminal.

        ``cancel_requested`` is already set by the single caller ``cancel``
        (BC-03) — set defensively here too so a direct call (tests) is safe.
        """
        turn.cancel_requested = True  # idempotent — cancel() already set it
        self._parked_sources.clear_session(turn.session_id)
        task = turn.task
        if task is None:  # guarded by the caller; defensive (asserts strip under -O)
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("cancelled turn task raised (session_id=%s)", turn.session_id)
        await self._persist_partial_guarded(turn, status="cancelled", error=None)
        turn.terminal_appended = True
        turn.buffer.append(ev_done("cancelled"))  # the single-shot terminal
        self._finalize(turn)

    # Phase 3 (BC-09): fold with _cancel_active
    async def _drain_active_with_error(self, turn: _Turn) -> None:
        """Shutdown twin of ``_cancel_active`` (BC-15): cancel the task, await
        propagation, persist the partial as ``error`` (server-side
        termination), append the single-shot ``error`` terminal, finalize.

        The ``cancel_requested`` flag is already set by the caller so
        ``_drive``'s finally skips its own terminal (same contract as cancel)."""
        self._parked_sources.clear_session(turn.session_id)
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

    async def _handle_timeout(self, turn: _Turn, timeout_s: float) -> None:
        """G5: the watchdog terminates with ``error``, never done(cancelled)."""
        self._parked_sources.clear_session(turn.session_id)
        logger.error(
            "turn watchdog fired after %ss (session_id=%s, trace_id=%s)",
            timeout_s,
            turn.session_id,
            turn.trace_id,
        )
        await self._persist_partial_guarded(
            turn,
            status="error",
            error={"message": _USER_SAFE_TIMEOUT, "trace_id": turn.trace_id},
        )
        turn.terminal_appended = True
        turn.buffer.append(ev_error(_USER_SAFE_TIMEOUT, turn.trace_id))

    async def _persist_partial_guarded(
        self, turn: _Turn, *, status: TurnStatus, error: dict[str, Any] | None
    ) -> None:
        """Best-effort partial persistence — a write failure (or a DB HANG)
        must never block the terminal event or hold the single-flight claim
        (BC-08). Each attempt is bounded by ``persist_partial_timeout_s``; a
        timeout is swallowed like any other failure so the caller proceeds to
        the terminal + finalize. One immediate retry (no backoff): the partial
        the student watched stream should survive a transient DB blip; a second
        failure (or timeout) is logged and swallowed."""
        timeout_s = self._settings.persist_partial_timeout_s
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

    async def _persist_partial(
        self, turn: _Turn, *, status: TurnStatus, error: dict[str, Any] | None
    ) -> None:
        """One ``aupdate_state``: partial prose (empty-partial rule) + record.

        The registry's vantage of the single terminal-persistence owner
        (``app.turn_persistence.build_terminal_update``, audit H1): it only sees
        wire events, so emissions rebuild the record; the source snapshot is the
        state registry (cumulative, G2); a cancel during a clarify RESUME
        replaces the parked record (same ``message_id``) with the answer frozen
        into ``clarify.answer`` (the ``_partial_anchor`` logic below).
        """
        if turn.ids is None:
            # Cancelled before meta: nothing streamed, no G1 identity to anchor
            # a record — the transcript stays as it was (nothing was shown).
            logger.info("skipping pre-meta partial record (session_id=%s)", turn.session_id)
            return
        config = {"configurable": {"thread_id": turn.session_id}}
        snapshot = await self._graph.aget_state(config)
        values = dict(snapshot.values) if snapshot else {}
        messages = list(values.get("messages") or [])
        records = list(values.get("turn_records") or [])
        registry_dump = SourceRegistry(values.get("source_registry") or []).wire_dump()
        user_text, offset, clarify, synthesized, selected_skills = _partial_anchor(
            turn, messages, records
        )
        update = build_terminal_update(
            messages=messages,
            records=records,
            emissions=turn.emissions,
            ids=turn.ids,
            status=status,
            sources=registry_dump,
            user_text=user_text,
            messages_offset=offset,
            error=error,
            clarify=clarify,
            synthesized_answer=synthesized,
            selected_skills=selected_skills,
            partial_history=list(turn.run_handle.messages_snapshot)
            if turn.run_handle is not None and turn.run_handle.messages_snapshot
            else None,
            emissions_len_at_snapshot=turn.run_handle.emissions_len_at_snapshot
            if turn.run_handle is not None
            else 0,
        )
        await self._graph.aupdate_state(config, update, as_node=AGENT_NODE)

    async def _unpark_if_parked(self, session_id: str) -> bool:
        """Cancel-on-parked (G4/G5): clear the interrupt and freeze the parked
        clarify record — its ``status`` becomes ``"cancelled"`` (so
        parked-detection releases) while ``clarify.answer`` stays null (the
        question was never answered). Spike-1-proven:
        ``aupdate_state(..., as_node=AGENT_NODE)`` empties the interrupts and
        clears ``next`` — the next plain message runs a fresh turn."""
        config = {"configurable": {"thread_id": session_id}}
        try:
            snapshot = await self._graph.aget_state(config)
        except Exception:
            logger.exception("parked-state read failed (session_id=%s)", session_id)
            return False
        if snapshot is None:
            return False
        records = list((snapshot.values or {}).get("turn_records") or [])
        parked = parked_record(records)
        has_interrupt = any(
            task.interrupts for task in (getattr(snapshot, "tasks", None) or ())
        )
        if parked is None and not has_interrupt:
            return False
        update: dict[str, Any] = {}
        if parked is not None:
            frozen = {**parked, "status": "cancelled"}
            update["turn_records"] = records[:-1] + [frozen]
        else:
            # An interrupt with no parked record to freeze — still clear it, but
            # this is an unexpected shape worth a breadcrumb.
            logger.warning(
                "unparking an interrupt with no parked record (session_id=%s)", session_id
            )
        try:
            await self._graph.aupdate_state(config, update, as_node=AGENT_NODE)
        except Exception:
            logger.exception("unpark aupdate_state failed (session_id=%s)", session_id)
            return False
        self._parked_sources.clear_session(session_id)
        return True

    # -- the G3 history rewrite ---------------------------------------------------

    async def _rewrite_history(self, session_id: str, replace_message_id: str) -> None:
        """Edit & regenerate: ONE ``aupdate_state`` rewrite (G3).

        Slices ``messages`` at the target record's ``messages_offset``,
        truncates ``turn_records`` from that turn onward, starts the new answer's
        source registry empty, and clears any pending interrupt (per G4 unpark). Regenerate is
        the same mechanism with the same text — the registry doesn't
        distinguish. Pre-MVP2 turns (no ``user_message_id``) and synthesized
        clarify-answer bubbles are never edit targets → :class:`InvalidEditTarget`.
        """
        self._parked_sources.clear_session(session_id)
        config = {"configurable": {"thread_id": session_id}}
        snapshot = await self._graph.aget_state(config)
        values = dict(snapshot.values) if snapshot else {}
        records = list(values.get("turn_records") or [])
        messages = list(values.get("messages") or [])
        index, offset = _resolve_edit_target(records, messages, replace_message_id, session_id)
        surviving = records[:index]
        registry_dump: list[dict[str, Any]] = []
        # The turn record is the sole parked signal (audit BC-14): no
        # OR-on-interrupt — a torn write could leave a stale interrupt that the
        # record (now cancelled) already disclaims.
        parked = is_parked(records)
        update: dict[str, Any] = {
            "messages": messages[:offset],
            "turn_records": surviving,
            "source_registry": registry_dump,
            "turn_ids": None,
        }
        if parked:
            await self._graph.aupdate_state(config, update, as_node=AGENT_NODE)
        else:
            await self._graph.aupdate_state(config, update)


def _partial_anchor(
    turn: _Turn, messages: list[dict[str, Any]], records: list[dict[str, Any]]
) -> tuple[str | None, int, dict[str, Any] | None, bool, tuple[str, ...]]:
    """The partial record's anchor: ``(user_text, messages_offset, clarify,
    synthesized_answer)``.

    A cancel during a clarify RESUME (the last record is this turn still
    parked, same ``message_id``) replaces the parked record: the original
    question stays the user_text, the parked offset carries forward, and the
    answer freezes into ``clarify.answer``. A fresh-turn cancel anchors on the
    tail user request (or past-the-end when the input never landed).
    """
    ids = turn.ids or {}
    # The resume-replace predicate: parked AND this turn reused the parked
    # message_id (the base parked test is is_parked; the id-match distinguishes
    # a cancel mid-resume from a fresh-turn cancel). The offset fallback is the
    # parked record's anchor, else resolve_offset's tail-request rule.
    parked = (
        records[-1]
        if is_parked(records) and records[-1].get("message_id") == ids.get("message_id")
        else None
    )
    if parked is not None:
        offset = resolve_offset(parked.get("messages_offset"), messages)
        spec = (parked.get("clarify") or {}).get("spec")
        clarify = {"spec": spec, "answer": turn.user_text} if spec else None
        return parked.get("user_text"), offset, clarify, True, _record_selected_skills(parked)
    return turn.user_text, resolve_offset(None, messages), None, False, turn.selected_skills


def _record_selected_skills(record: dict[str, Any]) -> tuple[str, ...]:
    """Read a persisted selection through the same public-skill allowlist."""
    stored = record.get("skills", [])
    if stored is None:
        stored = []
    if not isinstance(stored, list):
        raise InvalidSelectedSkills("stored skill selection is malformed")
    try:
        return tuple(validate_selected_skills(stored))
    except SelectedSkillValidationError as exc:
        raise InvalidSelectedSkills("stored skill selection is invalid") from exc


def _resolve_edit_target(
    records: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    replace_message_id: str,
    session_id: str,
) -> tuple[int, int]:
    """G3 target validation → ``(record index, messages_offset)``.

    Raises :class:`InvalidEditTarget` for: id not found (incl. every pre-MVP2
    turn — they have no ``user_message_id``), the synthesized clarify-answer
    bubble (the explicit flag, never id-absence), and a corrupt offset anchor
    (slicing on it would corrupt the thread — degrade honestly).
    """
    index = next(
        (
            i
            for i, record in enumerate(records)
            if record.get("user_message_id") == replace_message_id
        ),
        None,
    )
    if index is None:
        raise InvalidEditTarget("That message can't be edited.")
    target = records[index]
    if target.get("synthesized_answer"):
        raise InvalidEditTarget("A clarify answer can't be edited.")
    offset = target.get("messages_offset")
    if not isinstance(offset, int) or not 0 <= offset <= len(messages):
        logger.error(
            "edit target has corrupt messages_offset=%r (session_id=%s) — refusing the slice",
            offset,
            session_id,
        )
        raise InvalidEditTarget("That message can't be edited.")
    return index, offset
