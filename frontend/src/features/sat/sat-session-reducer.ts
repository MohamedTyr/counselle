import type { SatSessionRow, SatSubmitResult } from "@/api/sat/types";

/**
 * `useSatSession`'s pure state machine (plan §5.3). Every map below is keyed
 * by `question_id`, never by the current index, so a response that lands
 * after the student has moved on is still applied to the right question
 * (plan §5.3's "applied by its `question_id`").
 */

export interface SatReveal {
  isCorrect: boolean;
  correctAnswers: readonly string[];
  rationale: string;
}

export interface SatHistoryEntry {
  everCorrect: boolean;
  everIncorrect: boolean;
}

/** The `client_attempt_id` bound to the last-submitted answer for a
 * question, so a retry of an unchanged answer reuses it (a retry, plan
 * §5.5) while a changed answer mints a new one — the *decision* is made by
 * the caller (it needs `crypto.randomUUID()`, an impurity this module never
 * performs); this only remembers what was bound to what. */
export interface SatAttemptBinding {
  answer: string;
  clientAttemptId: string;
}

export interface SatSessionState {
  rows: readonly SatSessionRow[];
  index: number;
  /** Memory only (plan §5.3, Q3) — never persisted, never seeded from the
   * server. */
  answers: ReadonlyMap<string, string>;
  eliminations: ReadonlyMap<string, ReadonlySet<string>>;
  /** The submit response, kept for the life of the session (plan §5.3) —
   * upstream re-derives this locally on every revisit; without this map a
   * revisited question would lose its verdict, key, and explanation. */
  reveals: ReadonlyMap<string, SatReveal>;
  /** Seeded from the session rows at session start (a snapshot, plan §5.3)
   * and updated from each submit — the navigator reads this so ✓ / ✕ /
   * Upsolved flip the moment a verdict returns. */
  history: ReadonlyMap<string, SatHistoryEntry>;
  /** The submit guard, per question (plan §5.3) — a slow submit on one
   * question never blocks answering another. */
  inFlight: ReadonlySet<string>;
  attemptBindings: ReadonlyMap<string, SatAttemptBinding>;
}

export type SatSessionAction =
  | { type: "session_loaded"; rows: readonly SatSessionRow[] }
  | { type: "index_changed"; index: number }
  | { type: "answer_changed"; questionId: string; answer: string }
  | { type: "eliminate_toggled"; questionId: string; label: string }
  | { type: "submit_started"; questionId: string; answer: string; clientAttemptId: string }
  | { type: "submit_succeeded"; questionId: string; result: SatSubmitResult }
  | { type: "submit_failed"; questionId: string }
  | { type: "bookmark_patched"; questionId: string; bookmarked: boolean };

/** Builds the state a freshly-loaded (or reloaded) session starts from.
 * `history` is seeded here, once, from the rows' own `ever_correct` /
 * `ever_incorrect` — a snapshot at session start, as upstream's
 * `historyAttempts` is (plan §5.3). */
export function createInitialSatSessionState(
  rows: readonly SatSessionRow[],
): SatSessionState {
  const history = new Map<string, SatHistoryEntry>(
    rows.map((row) => [
      row.id,
      { everCorrect: row.ever_correct, everIncorrect: row.ever_incorrect },
    ]),
  );
  return {
    rows,
    index: 0,
    answers: new Map(),
    eliminations: new Map(),
    reveals: new Map(),
    history,
    inFlight: new Set(),
    attemptBindings: new Map(),
  };
}

function withEliminationToggled(
  eliminations: ReadonlyMap<string, ReadonlySet<string>>,
  questionId: string,
  label: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const current = eliminations.get(questionId) ?? new Set<string>();
  const next = new Set(current);
  if (next.has(label)) {
    next.delete(label);
  } else {
    next.add(label);
  }
  const map = new Map(eliminations);
  map.set(questionId, next);
  return map;
}

function withInFlight(
  inFlight: ReadonlySet<string>,
  questionId: string,
  present: boolean,
): ReadonlySet<string> {
  const set = new Set(inFlight);
  if (present) {
    set.add(questionId);
  } else {
    set.delete(questionId);
  }
  return set;
}

function withHistoryFromResult(
  history: ReadonlyMap<string, SatHistoryEntry>,
  questionId: string,
  isCorrect: boolean,
): ReadonlyMap<string, SatHistoryEntry> {
  const previous = history.get(questionId) ?? { everCorrect: false, everIncorrect: false };
  const map = new Map(history);
  map.set(questionId, {
    everCorrect: previous.everCorrect || isCorrect,
    everIncorrect: previous.everIncorrect || !isCorrect,
  });
  return map;
}

function withBookmarkPatched(
  rows: readonly SatSessionRow[],
  questionId: string,
  bookmarked: boolean,
): readonly SatSessionRow[] {
  return rows.map((row) => (row.id === questionId ? { ...row, bookmarked } : row));
}

export function satSessionReducer(
  state: SatSessionState,
  action: SatSessionAction,
): SatSessionState {
  switch (action.type) {
    case "index_changed": {
      if (action.index < 0 || action.index >= state.rows.length) {
        return state;
      }
      return { ...state, index: action.index };
    }

    case "answer_changed": {
      const answers = new Map(state.answers);
      answers.set(action.questionId, action.answer);
      return { ...state, answers };
    }

    case "eliminate_toggled": {
      return {
        ...state,
        eliminations: withEliminationToggled(
          state.eliminations,
          action.questionId,
          action.label,
        ),
      };
    }

    case "submit_started": {
      const attemptBindings = new Map(state.attemptBindings);
      attemptBindings.set(action.questionId, {
        answer: action.answer,
        clientAttemptId: action.clientAttemptId,
      });
      return {
        ...state,
        attemptBindings,
        inFlight: withInFlight(state.inFlight, action.questionId, true),
      };
    }

    case "submit_succeeded": {
      const reveals = new Map(state.reveals);
      reveals.set(action.questionId, {
        isCorrect: action.result.is_correct,
        correctAnswers: action.result.correct_answers,
        rationale: action.result.rationale,
      });
      return {
        ...state,
        reveals,
        history: withHistoryFromResult(
          state.history,
          action.questionId,
          action.result.is_correct,
        ),
        inFlight: withInFlight(state.inFlight, action.questionId, false),
      };
    }

    case "submit_failed": {
      return {
        ...state,
        inFlight: withInFlight(state.inFlight, action.questionId, false),
      };
    }

    case "bookmark_patched": {
      return {
        ...state,
        rows: withBookmarkPatched(state.rows, action.questionId, action.bookmarked),
      };
    }

    default:
      return state;
  }
}

// --- per-question selectors (plan §5.3) -----------------------------------

export function selectAnswer(state: SatSessionState, questionId: string): string | undefined {
  return state.answers.get(questionId);
}

export function selectEliminations(
  state: SatSessionState,
  questionId: string,
): ReadonlySet<string> {
  return state.eliminations.get(questionId) ?? new Set();
}

export function selectReveal(
  state: SatSessionState,
  questionId: string,
): SatReveal | undefined {
  return state.reveals.get(questionId);
}

export function selectHistory(
  state: SatSessionState,
  questionId: string,
): SatHistoryEntry {
  return state.history.get(questionId) ?? { everCorrect: false, everIncorrect: false };
}

export function selectIsInFlight(state: SatSessionState, questionId: string): boolean {
  return state.inFlight.has(questionId);
}

/** The `client_attempt_id` a submit for `questionId` should use: the bound
 * id when the answer hasn't changed since the last submit (a retry, plan
 * §5.5), otherwise `undefined` — signalling the caller to mint a fresh one. */
export function selectReusableAttemptId(
  state: SatSessionState,
  questionId: string,
  answer: string,
): string | undefined {
  const binding = state.attemptBindings.get(questionId);
  return binding && binding.answer === answer ? binding.clientAttemptId : undefined;
}
