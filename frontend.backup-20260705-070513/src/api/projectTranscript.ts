/**
 * projectTranscript — pure transcript → ChatMessage projection helpers.
 *
 * PURE module: no React, no I/O. Both a persisted transcript and the live
 * stream's terminal/error turn project through these helpers; assistant entries
 * reduce through the SAME turn reducer the live stream used. Extracted from
 * ChatContext (Phase 5 / FE-CHATCONTEXT-GOD) so the projection is independently
 * testable and the provider only composes it.
 *
 * `ChatMessage` is defined here and re-exported by `@/app/ChatContext`, so the
 * public symbol path `@/app/ChatContext` → `ChatMessage` is preserved exactly.
 */
import {
  deriveDurationMs,
  proseOf,
  reduceTranscriptEntry,
  toStepRecord,
  type ContentBlock,
  type TimelineEntry,
  type TurnState,
  type TurnStatus,
} from '@/api/turn-reducer';
import type {
  ClarifySpec,
  ErrorData,
  SourceEntry,
  StepRecord,
  TranscriptEntry,
} from '@/api/protocol';

// ── Message shape (what the vendored components consume) ─────────────────────

export type ChatMessage = {
  messageId: string;
  conversationId: string;
  parentMessageId: string | null;
  /** Concatenated prose (user text, or the turn's markdown joined). */
  text: string;
  isCreatedByUser: boolean;
  sender: string;
  error: boolean;
  unfinished: boolean;
  /** Ordered render blocks (assistant only) — reference-stable when unchanged. */
  content?: ContentBlock[];
  stepRecord?: StepRecord;
  /** Ordered step labels the collapsed header cycles through while streaming. */
  activities?: string[];
  /** FE-4: the activity timeline (steps + thinking, arrival order). */
  timeline?: TimelineEntry[];
  /** FE-4: the derived one-line receipt the timeline collapses to at done. */
  receipt?: string;
  /** FE-4: total worked time (sum of step receipt durations). */
  durationMs?: number;
  sources?: SourceEntry[];
  clarify?: ClarifySpec;
  /** The persisted clarify answer (transcript only): non-null = the chosen
   *  resume text (the widget freezes seeded to it); null/undefined = unanswered
   *  / the live parked widget. Threaded outside the reducer event replay
   *  (wire-contract §8b) — carried in view-state. */
  clarifyAnswer?: string | null;
  turnStatus?: TurnStatus;
  streamError?: ErrorData;
  /** B5d dead-air cover: the turn is live but nothing is visibly progressing
   *  (no active step, no streaming prose tail) — render the "Thinking…" shimmer.
   *  Truthful: the model IS thinking; it vanishes the instant a real event lands. */
  isThinking?: boolean;
  feedback?: { rating: 'thumbsUp' | 'thumbsDown' };
  /** G4: a synthesized clarify-answer user bubble — never an edit target (the
   *  backend returns 422). Surfaced so HoverButtons hides Edit on it. */
  synthesized?: boolean;
  /** Whether the backend assigned this message a real id (vs a temp/derived
   *  one). Edit is hidden on id-less entries (pre-MVP2 / not yet reconciled). */
  hasBackendId?: boolean;
  ts: string | null;
};

/** The truncate-and-re-ask payload (EditMessage save-and-submit / clarify
 *  answer). Pure type — lives here so vendored type files depend on a pure
 *  module, not the provider (FE-COUPLING). */
export type AskProps = {
  text: string;
  /** When re-asking an edited user message: the message being replaced. */
  messageId?: string | null;
  parentMessageId?: string | null;
  conversationId?: string | null;
};

/** The generic collapsed-header label for narration gaps (mockup parity). */
export const THINKING_LABEL = 'Thinking…';

/**
 * FE-TYPE-DERIVED-STORED: memoize the derived `activities` array on the
 * `timeline` identity. The reducer is immutable and replaces `state.timeline`
 * only when a step/thinking entry actually changes, so keying a WeakMap on
 * `state.timeline` yields the SAME `activities` array reference for an
 * unchanged timeline. That lets `areMessageRenderPropsEqual` compare
 * `activities` with `===` instead of a `join('\x00')` content compare.
 */
const activitiesByTimeline = new WeakMap<TimelineEntry[], string[]>();

function deriveActivities(timeline: TimelineEntry[]): string[] {
  const cached = activitiesByTimeline.get(timeline);
  if (cached !== undefined) {
    return cached;
  }
  // The ordered labels the collapsed header cycles through (the mockup's
  // setNow-per-step): each step's label in arrival order, with a generic
  // "Thinking…" for narration gaps (never the narration text). The ticker dwells
  // ≥850ms on each, so a burst of fast local-DB tools still plays one at a time
  // rather than skipping straight to the last. Consecutive dups collapse.
  const activities = timeline
    .map((entry) => (entry.type === 'step' ? entry.step.label : THINKING_LABEL))
    .filter((label, i, arr) => i === 0 || label !== arr[i - 1]);
  activitiesByTimeline.set(timeline, activities);
  return activities;
}

export function assistantMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  state: TurnState,
  ts: string | null,
): ChatMessage {
  const record = toStepRecord(state);
  const activeStep = [...state.steps].reverse().find((s) => s.status === 'start');
  const activities = deriveActivities(state.timeline);
  const isLive = state.status === 'streaming' || state.status === 'idle';
  // Dead air: live, no step currently in progress (an active step row already
  // shimmers), no streaming prose tail (a growing answer is its own motion), and
  // no thinking lines (the ReasoningTrace rail already renders a thinking row —
  // the orb "Thinking…" must not double up on it). It is the mount trigger for
  // ReasoningTrace at zero entries (the send→first-event / step-end→next gaps).
  const lastBlock = state.blocks[state.blocks.length - 1];
  const hasProseTail = lastBlock !== undefined && lastBlock.kind === 'markdown';
  const isThinking =
    isLive && activeStep === undefined && !hasProseTail && state.thinking.length === 0;
  return {
    messageId,
    conversationId,
    parentMessageId,
    text: proseOf(state),
    isCreatedByUser: false,
    sender: 'Counselle',
    error: false,
    unfinished: state.status === 'cancelled',
    content: state.blocks,
    stepRecord: record,
    activities,
    timeline: state.timeline,
    receipt: record?.receipt,
    durationMs: deriveDurationMs(state.steps),
    sources: state.sources.length > 0 ? state.sources : undefined,
    clarify: state.clarify ?? undefined,
    turnStatus: state.status,
    streamError: state.error ?? undefined,
    isThinking,
    feedback: undefined,
    ts,
  };
}

export function userMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  text: string,
  ts: string | null,
): ChatMessage {
  return {
    messageId,
    conversationId,
    parentMessageId,
    text,
    isCreatedByUser: true,
    sender: '',
    error: false,
    unfinished: false,
    ts,
  };
}

/** Project a persisted transcript into ChatMessages — assistant entries reduce
 * through the SAME turn reducer the live stream used. Feedback hydrates from the
 * entry's own `feedback` field (B5a: server-joined; no client feedback store). */
export function messagesFromTranscript(
  conversationId: string,
  entries: TranscriptEntry[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  entries.forEach((entry, i) => {
    const hasBackendId = entry.message_id !== undefined;
    const messageId = entry.message_id ?? `msg-${conversationId}-${i}`;
    const parentMessageId = i > 0 ? (messages[i - 1]?.messageId ?? null) : null;
    if (entry.role === 'user') {
      messages.push({
        ...userMessage(conversationId, messageId, parentMessageId, entry.text, entry.ts),
        synthesized: entry.synthesized === true,
        hasBackendId,
      });
      return;
    }
    const state = reduceTranscriptEntry(entry);
    const message = assistantMessage(conversationId, messageId, parentMessageId, state, entry.ts);
    message.hasBackendId = hasBackendId;
    // The persisted clarify answer is threaded outside the reducer's event
    // replay (the event carries only the bare spec, wire-contract §8b): the
    // frozen widget seeds its selection from it.
    message.clarifyAnswer = entry.clarify !== undefined ? entry.clarify.answer : undefined;
    // Thumbs survive reload: map the entry's wire rating ('up'/'down') to the
    // component's thumbsUp/thumbsDown (mirrors the prior feedbackOf seam).
    message.feedback =
      entry.feedback !== undefined
        ? { rating: entry.feedback.rating === 'up' ? 'thumbsUp' : 'thumbsDown' }
        : undefined;
    messages.push(message);
  });
  return messages;
}
