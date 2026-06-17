/**
 * Error mapping for the chat turn loop — transport errors → the user-facing
 * `TurnError`/`TranscriptError` shapes the composer + banner render. Extracted
 * from ChatContext (Phase 5 / FE-CHATCONTEXT-GOD) so the turn engine and the
 * provider share one mapper without importing each other.
 */
import { isTransportError } from '@/api/http/errors';

/** A surfaced turn error the composer renders (retry keeps the kept text). */
export type TurnError =
  | { kind: 'rate_limited'; message: string; retryAfter?: number }
  | { kind: 'unauthorized' | 'network' | 'server' | 'stream'; message: string };

/** A transcript-load failure — opening an existing chat couldn't read it.
 *  Surfaced as an honest banner + retry, never a silently-blank conversation. */
export type TranscriptError = {
  kind: 'unauthorized' | 'network' | 'server';
  message: string;
};

export function turnErrorOf(error: unknown): TurnError {
  if (isTransportError(error)) {
    if (error.kind === 'rate_limited') {
      const wait =
        error.retryAfter !== undefined
          ? `Try again in ${error.retryAfter} second${error.retryAfter === 1 ? '' : 's'}.`
          : 'Try again in a moment.';
      return { kind: 'rate_limited', message: wait, retryAfter: error.retryAfter };
    }
    if (error.kind === 'unauthorized') {
      return { kind: 'unauthorized', message: 'Please sign in to continue.' };
    }
    if (error.kind === 'network') {
      return { kind: 'network', message: 'Could not reach the server. Check your connection.' };
    }
    return { kind: 'server', message: error.message };
  }
  return { kind: 'stream', message: 'Something went wrong. Please try again.' };
}

export function transcriptErrorOf(error: unknown): TranscriptError {
  if (isTransportError(error)) {
    if (error.kind === 'unauthorized') {
      return { kind: 'unauthorized', message: 'Please sign in to view this conversation.' };
    }
    if (error.kind === 'network') {
      return {
        kind: 'network',
        message: "Couldn't load this conversation. Check your connection.",
      };
    }
  }
  return { kind: 'server', message: "Couldn't load this conversation." };
}
