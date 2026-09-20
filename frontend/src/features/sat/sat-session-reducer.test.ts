import { describe, expect, it } from "vitest";

import {
  createInitialSatSessionState,
  satSessionReducer,
  selectAnswer,
  selectEliminations,
  selectHistory,
  selectIsInFlight,
  selectReusableAttemptId,
  selectReveal,
  type SatSessionState,
} from "./sat-session-reducer";
import type { SatSessionRow, SatSubmitResult } from "@/api/sat/types";

function row(overrides: Partial<SatSessionRow> = {}): SatSessionRow {
  return {
    id: "q1",
    score_band: 4,
    content_sha: "sha1",
    bookmarked: false,
    ever_correct: false,
    ever_incorrect: false,
    ...overrides,
  };
}

function result(overrides: Partial<SatSubmitResult> = {}): SatSubmitResult {
  return {
    is_correct: true,
    correct_answers: ["A"],
    rationale: "because",
    attempts: [],
    ...overrides,
  };
}

describe("createInitialSatSessionState", () => {
  it("seeds history from the session rows' ever_correct / ever_incorrect", () => {
    const rows = [
      row({ id: "q1", ever_correct: true, ever_incorrect: true }),
      row({ id: "q2", ever_correct: false, ever_incorrect: false }),
    ];
    const state = createInitialSatSessionState(rows);
    expect(selectHistory(state, "q1")).toEqual({ everCorrect: true, everIncorrect: true });
    expect(selectHistory(state, "q2")).toEqual({ everCorrect: false, everIncorrect: false });
  });

  it("starts at index 0 with empty answers/eliminations/reveals/inFlight", () => {
    const state = createInitialSatSessionState([row()]);
    expect(state.index).toBe(0);
    expect(state.answers.size).toBe(0);
    expect(state.eliminations.size).toBe(0);
    expect(state.reveals.size).toBe(0);
    expect(state.inFlight.size).toBe(0);
  });

  it("defaults an unseen question's history to never correct/incorrect", () => {
    const state = createInitialSatSessionState([row({ id: "q1" })]);
    expect(selectHistory(state, "unknown")).toEqual({
      everCorrect: false,
      everIncorrect: false,
    });
  });
});

describe("index_changed", () => {
  const state = createInitialSatSessionState([row({ id: "q1" }), row({ id: "q2" })]);

  it("moves to a valid index", () => {
    const next = satSessionReducer(state, { type: "index_changed", index: 1 });
    expect(next.index).toBe(1);
  });

  it("ignores an out-of-range index", () => {
    expect(satSessionReducer(state, { type: "index_changed", index: -1 }).index).toBe(0);
    expect(satSessionReducer(state, { type: "index_changed", index: 2 }).index).toBe(0);
  });
});

describe("answer_changed", () => {
  it("records the answer for that question only", () => {
    const state = createInitialSatSessionState([row({ id: "q1" }), row({ id: "q2" })]);
    const next = satSessionReducer(state, {
      type: "answer_changed",
      questionId: "q1",
      answer: "B",
    });
    expect(selectAnswer(next, "q1")).toBe("B");
    expect(selectAnswer(next, "q2")).toBeUndefined();
  });
});

describe("eliminate_toggled", () => {
  it("adds then removes a label", () => {
    const state = createInitialSatSessionState([row({ id: "q1" })]);
    const eliminated = satSessionReducer(state, {
      type: "eliminate_toggled",
      questionId: "q1",
      label: "B",
    });
    expect(selectEliminations(eliminated, "q1").has("B")).toBe(true);

    const restored = satSessionReducer(eliminated, {
      type: "eliminate_toggled",
      questionId: "q1",
      label: "B",
    });
    expect(selectEliminations(restored, "q1").has("B")).toBe(false);
  });

  it("keeps eliminations for other questions independent", () => {
    const state = createInitialSatSessionState([row({ id: "q1" }), row({ id: "q2" })]);
    const next = satSessionReducer(state, {
      type: "eliminate_toggled",
      questionId: "q1",
      label: "C",
    });
    expect(selectEliminations(next, "q2").size).toBe(0);
  });
});

describe("submit lifecycle", () => {
  function withSubmitStarted(
    state: SatSessionState,
    questionId: string,
    answer: string,
    clientAttemptId: string,
  ) {
    return satSessionReducer(state, {
      type: "submit_started",
      questionId,
      answer,
      clientAttemptId,
    });
  }

  it("submit_started marks the question in flight and binds the attempt id", () => {
    const state = createInitialSatSessionState([row({ id: "q1" })]);
    const next = withSubmitStarted(state, "q1", "A", "attempt-1");
    expect(selectIsInFlight(next, "q1")).toBe(true);
    expect(selectReusableAttemptId(next, "q1", "A")).toBe("attempt-1");
  });

  it("submit_succeeded fills the reveal, updates history, and clears inFlight", () => {
    const state = withSubmitStarted(
      createInitialSatSessionState([row({ id: "q1" })]),
      "q1",
      "A",
      "attempt-1",
    );
    const next = satSessionReducer(state, {
      type: "submit_succeeded",
      questionId: "q1",
      result: result({ is_correct: true, correct_answers: ["A"], rationale: "why" }),
    });
    expect(selectReveal(next, "q1")).toEqual({
      isCorrect: true,
      correctAnswers: ["A"],
      rationale: "why",
    });
    expect(selectHistory(next, "q1")).toEqual({ everCorrect: true, everIncorrect: false });
    expect(selectIsInFlight(next, "q1")).toBe(false);
  });

  it("submit_succeeded ORs into existing history rather than overwriting it", () => {
    // Seed history with an already-incorrect attempt, then submit a correct one.
    const state = createInitialSatSessionState([row({ id: "q1", ever_incorrect: true })]);
    const next = satSessionReducer(state, {
      type: "submit_succeeded",
      questionId: "q1",
      result: result({ is_correct: true }),
    });
    expect(selectHistory(next, "q1")).toEqual({ everCorrect: true, everIncorrect: true });
  });

  it("submit_failed clears inFlight but leaves the answer and reveal untouched", () => {
    const started = withSubmitStarted(
      satSessionReducer(createInitialSatSessionState([row({ id: "q1" })]), {
        type: "answer_changed",
        questionId: "q1",
        answer: "A",
      }),
      "q1",
      "A",
      "attempt-1",
    );
    const next = satSessionReducer(started, { type: "submit_failed", questionId: "q1" });
    expect(selectIsInFlight(next, "q1")).toBe(false);
    expect(selectAnswer(next, "q1")).toBe("A");
    expect(selectReveal(next, "q1")).toBeUndefined();
  });

  it("applies a response by question_id — a late response for a non-current question still lands", () => {
    const state = createInitialSatSessionState([row({ id: "q1" }), row({ id: "q2" })]);
    // The student has moved on to q2; a slow q1 submit resolves after.
    const withIndex = satSessionReducer(state, { type: "index_changed", index: 1 });
    const next = satSessionReducer(withIndex, {
      type: "submit_succeeded",
      questionId: "q1",
      result: result({ is_correct: false }),
    });
    expect(next.index).toBe(1);
    expect(selectReveal(next, "q1")).toBeDefined();
    expect(selectReveal(next, "q2")).toBeUndefined();
  });

  it("a slow submit on one question never marks another in flight", () => {
    const state = createInitialSatSessionState([row({ id: "q1" }), row({ id: "q2" })]);
    const next = withSubmitStarted(state, "q1", "A", "attempt-1");
    expect(selectIsInFlight(next, "q1")).toBe(true);
    expect(selectIsInFlight(next, "q2")).toBe(false);
  });
});

describe("client_attempt_id reuse (plan §5.5)", () => {
  it("reuses the bound id when the answer is unchanged (a retry)", () => {
    const state = satSessionReducer(createInitialSatSessionState([row({ id: "q1" })]), {
      type: "submit_started",
      questionId: "q1",
      answer: "A",
      clientAttemptId: "attempt-1",
    });
    expect(selectReusableAttemptId(state, "q1", "A")).toBe("attempt-1");
  });

  it("signals a fresh id is needed once the answer changes", () => {
    const state = satSessionReducer(createInitialSatSessionState([row({ id: "q1" })]), {
      type: "submit_started",
      questionId: "q1",
      answer: "A",
      clientAttemptId: "attempt-1",
    });
    expect(selectReusableAttemptId(state, "q1", "B")).toBeUndefined();
  });

  it("has no binding to reuse before any submit", () => {
    const state = createInitialSatSessionState([row({ id: "q1" })]);
    expect(selectReusableAttemptId(state, "q1", "A")).toBeUndefined();
  });
});

describe("bookmark_patched", () => {
  it("patches only the matching row, immutably", () => {
    const rows = [row({ id: "q1", bookmarked: false }), row({ id: "q2", bookmarked: false })];
    const state = createInitialSatSessionState(rows);
    const next = satSessionReducer(state, {
      type: "bookmark_patched",
      questionId: "q1",
      bookmarked: true,
    });
    expect(next.rows.find((r) => r.id === "q1")?.bookmarked).toBe(true);
    expect(next.rows.find((r) => r.id === "q2")?.bookmarked).toBe(false);
    expect(next.rows).not.toBe(state.rows);
  });

  it("is reversible — the same action re-applied with the prior value rolls it back", () => {
    const state = createInitialSatSessionState([row({ id: "q1", bookmarked: false })]);
    const patched = satSessionReducer(state, {
      type: "bookmark_patched",
      questionId: "q1",
      bookmarked: true,
    });
    const rolledBack = satSessionReducer(patched, {
      type: "bookmark_patched",
      questionId: "q1",
      bookmarked: false,
    });
    expect(rolledBack.rows.find((r) => r.id === "q1")?.bookmarked).toBe(false);
  });
});
