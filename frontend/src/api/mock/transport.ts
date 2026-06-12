/**
 * MockTransport — replays fixture event arrays as an AsyncIterable with
 * realistic timing (frontend-plan §3). Scenario router picks the fixture by
 * user text. Supports cancel (the stream terminates with done(cancelled),
 * §27.4) and attach (in-memory replay of already-emitted events, then live).
 */
import type { ProtocolEvent, TranscriptEntry } from '@/api/protocol';
import type { SendMessageBody, Transport } from '@/api/transport';
import { getTranscript } from './messagesStore';
import { CANCELLED_EVENTS } from './fixtures/turns/cancelled';
import { CLARIFY_EVENTS } from './fixtures/turns/clarify';
import { DOSSIER_EVENTS } from './fixtures/turns/dossier';
import { ERROR_EVENTS } from './fixtures/turns/error';
import { SIMPLE_EVENTS } from './fixtures/turns/simple';

// ── Timing (latency theater) ─────────────────────────────────────────────────

const DELTA_DELAY_MIN_MS = 15;
const DELTA_DELAY_MAX_MS = 40;
const STEP_GAP_MIN_MS = 300;
const STEP_GAP_MAX_MS = 900;
const THINKING_DELAY_MS = 220;
const TRAILER_DELAY_MS = 80;

function jitter(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function delayFor(event: ProtocolEvent): number {
  switch (event.type) {
    case 'meta':
      return 0;
    case 'delta':
      return jitter(DELTA_DELAY_MIN_MS, DELTA_DELAY_MAX_MS);
    case 'step':
      // The gap models the work between the previous event and this one.
      return event.data.status === 'start'
        ? jitter(STEP_GAP_MIN_MS / 2, STEP_GAP_MIN_MS)
        : jitter(STEP_GAP_MIN_MS, STEP_GAP_MAX_MS);
    case 'thinking':
      return THINKING_DELAY_MS;
    case 'viz':
      return jitter(STEP_GAP_MIN_MS / 2, STEP_GAP_MIN_MS);
    default:
      return TRAILER_DELAY_MS;
  }
}

// ── Scenario router ──────────────────────────────────────────────────────────

function pickFixture(text: string): ProtocolEvent[] {
  const lower = text.toLowerCase();
  // FE-4: the clarify scenario wins over dossier ("compare X and Y dossier").
  if (lower.includes('compare') || lower.includes('clarify')) {
    return CLARIFY_EVENTS;
  }
  if (lower.includes('dossier')) {
    return DOSSIER_EVENTS;
  }
  if (lower.includes('fail')) {
    return ERROR_EVENTS;
  }
  if (lower.includes('cancel')) {
    return CANCELLED_EVENTS;
  }
  return SIMPLE_EVENTS;
}

// ── The active turn (in-memory ring of emitted events + live tail) ──────────

class ActiveTurn {
  readonly emitted: ProtocolEvent[] = [];
  finished = false;

  private readonly abort = new AbortController();
  private notify: (() => void) | null = null;
  private waiters: Array<() => void> = [];

  constructor(private readonly fixture: ProtocolEvent[]) {
    void this.run();
  }

  cancel(): void {
    this.abort.abort();
  }

  private async run(): Promise<void> {
    for (const event of this.fixture) {
      const cancelled = await this.sleep(delayFor(event));
      if (cancelled) {
        this.emit({ v: 1, type: 'done', data: { status: 'cancelled' } });
        this.end();
        return;
      }
      this.emit(event);
      if (event.type === 'done' || event.type === 'error') {
        this.end();
        return;
      }
    }
    this.end();
  }

  /** Abortable sleep — resolves true if the turn was cancelled. */
  private sleep(ms: number): Promise<boolean> {
    if (this.abort.signal.aborted) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.abort.signal.removeEventListener('abort', onAbort);
        resolve(false);
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      this.abort.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private emit(event: ProtocolEvent): void {
    this.emitted.push(event);
    this.wake();
  }

  private end(): void {
    this.finished = true;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  private nextSignal(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Yield emitted events from `from`, then follow the live tail to the end. */
  async *stream(from = 0): AsyncGenerator<ProtocolEvent, void, undefined> {
    let i = from;
    for (;;) {
      while (i < this.emitted.length) {
        yield this.emitted[i];
        i += 1;
      }
      if (this.finished) {
        return;
      }
      await this.nextSignal();
    }
  }
}

// ── The transport ────────────────────────────────────────────────────────────

export class MockTransport implements Transport {
  private readonly turns = new Map<string, ActiveTurn>();

  sendMessage(sessionId: string, body: SendMessageBody): AsyncIterable<ProtocolEvent> {
    const turn = new ActiveTurn(pickFixture(body.text));
    this.turns.set(sessionId, turn);
    return turn.stream();
  }

  attach(sessionId: string, lastEventId?: string): AsyncIterable<ProtocolEvent> {
    const turn = this.turns.get(sessionId);
    if (turn === undefined) {
      // No active turn in this process — the client falls back to the
      // transcript read (§27.3's 204 path).
      return (async function* empty() {
        // yields nothing
      })();
    }
    const from = lastEventId === undefined ? 0 : Number(lastEventId) + 1;
    return turn.stream(Number.isFinite(from) ? from : 0);
  }

  cancel(sessionId: string): Promise<void> {
    this.turns.get(sessionId)?.cancel();
    return Promise.resolve();
  }

  transcript(sessionId: string): Promise<TranscriptEntry[]> {
    return Promise.resolve(getTranscript(sessionId));
  }
}

/** The app-wide transport instance (VITE_TRANSPORT=http arrives in FE-7). */
export const mockTransport = new MockTransport();
