import { useEffect, useMemo, useRef, useState } from "react";

export type ClarifyDraftKey = {
  sessionId: string;
  clarifyMessageId: string;
  specVersion: number;
  specIdentity: string;
} | null;

export type ClarifyDraftState = {
  currentQuestionIndex: number;
  selectedOptionIds: string[];
  customText: string;
  validationError: string | null;
  answersByQuestionId: Record<string, ClarifyQuestionDraft>;
  sendState: "idle" | "sending" | "checking" | "answered";
};

export type ClarifyQuestionDraft = {
  selectedOptionIds: string[];
  customText: string;
  validationError: string | null;
};

export type ClarifyDraftController = {
  draft: ClarifyDraftState;
  canSubmit: boolean;
  setCurrentQuestionIndex: (index: number) => void;
  setSelectedOptionIds: (optionIds: readonly string[]) => void;
  setCustomText: (customText: string) => void;
  setValidationError: (validationError: string | null) => void;
  answerForQuestion: (questionId: string) => ClarifyQuestionDraft;
  setQuestionAnswer: (
    questionId: string,
    update: (previous: ClarifyQuestionDraft) => ClarifyQuestionDraft,
  ) => void;
  setQuestionValidationError: (
    questionId: string,
    validationError: string | null,
  ) => void;
  markSending: () => void;
  markChecking: () => void;
  markAnswered: () => void;
};

function initialDraft(): ClarifyDraftState {
  return {
    currentQuestionIndex: 0,
    selectedOptionIds: [],
    customText: "",
    validationError: null,
    answersByQuestionId: {},
    sendState: "idle",
  };
}

function initialQuestionDraft(): ClarifyQuestionDraft {
  return {
    selectedOptionIds: [],
    customText: "",
    validationError: null,
  };
}

const STORAGE_PREFIX = "counselle.clarifyDraft.";

function storageKey(stableKey: string): string | null {
  return stableKey === "none" ? null : `${STORAGE_PREFIX}${stableKey}`;
}

function normalizeQuestionDraft(value: unknown): ClarifyQuestionDraft {
  if (typeof value !== "object" || value === null) {
    return initialQuestionDraft();
  }
  const record = value as Record<string, unknown>;
  const selectedOptionIds = Array.isArray(record.selectedOptionIds)
    ? record.selectedOptionIds.filter(
        (optionId): optionId is string => typeof optionId === "string",
      )
    : [];
  return {
    selectedOptionIds,
    customText: typeof record.customText === "string" ? record.customText : "",
    validationError: null,
  };
}

function sanitizeDraftForStorage(draft: ClarifyDraftState): ClarifyDraftState {
  return {
    currentQuestionIndex: Math.max(0, draft.currentQuestionIndex),
    selectedOptionIds: [...draft.selectedOptionIds],
    customText: draft.customText,
    validationError: null,
    answersByQuestionId: Object.fromEntries(
      Object.entries(draft.answersByQuestionId).map(([questionId, value]) => [
        questionId,
        normalizeQuestionDraft(value),
      ]),
    ),
    sendState: "idle",
  };
}

function readStoredDraft(stableKey: string): ClarifyDraftState {
  const key = storageKey(stableKey);
  if (key === null || typeof window === "undefined") {
    return initialDraft();
  }
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) {
      return initialDraft();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return initialDraft();
    }
    const record = parsed as Record<string, unknown>;
    const answersByQuestionId =
      typeof record.answersByQuestionId === "object" &&
      record.answersByQuestionId !== null
        ? Object.fromEntries(
            Object.entries(record.answersByQuestionId).map(
              ([questionId, value]) => [questionId, normalizeQuestionDraft(value)],
            ),
          )
        : {};
    return {
      currentQuestionIndex:
        typeof record.currentQuestionIndex === "number"
          ? Math.max(0, record.currentQuestionIndex)
          : 0,
      selectedOptionIds: Array.isArray(record.selectedOptionIds)
        ? record.selectedOptionIds.filter(
            (optionId): optionId is string => typeof optionId === "string",
          )
        : [],
      customText: typeof record.customText === "string" ? record.customText : "",
      validationError: null,
      answersByQuestionId,
      sendState: "idle",
    };
  } catch {
    return initialDraft();
  }
}

function writeStoredDraft(stableKey: string, draft: ClarifyDraftState) {
  const key = storageKey(stableKey);
  if (key === null || typeof window === "undefined") {
    return;
  }
  try {
    if (draft.sendState === "answered") {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(
      key,
      JSON.stringify(sanitizeDraftForStorage(draft)),
    );
  } catch {
    // Draft persistence is convenience only; the durable transcript still
    // reloads from the backend.
  }
}

function clearStoredDraft(stableKey: string) {
  const key = storageKey(stableKey);
  if (key === null || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Draft persistence is best-effort convenience only.
  }
}

export function useClarifyDraft(key: ClarifyDraftKey): ClarifyDraftController {
  const stableKey = useMemo(
    () =>
      key === null
        ? "none"
        : `${key.sessionId}:${key.clarifyMessageId}:${key.specVersion}:${key.specIdentity}`,
    [key],
  );
  const [state, setState] = useState(() => ({
    key: stableKey,
    draft: readStoredDraft(stableKey),
  }));
  const previousStableKeyRef = useRef(stableKey);
  const draft = state.key === stableKey ? state.draft : readStoredDraft(stableKey);

  useEffect(() => {
    const previousKey = previousStableKeyRef.current;
    if (previousKey !== stableKey) {
      clearStoredDraft(previousKey);
      previousStableKeyRef.current = stableKey;
    }
  }, [stableKey]);

  const updateDraft = (
    update: (previous: ClarifyDraftState) => ClarifyDraftState,
  ) =>
    setState((previous) => {
      const nextDraft = update(
        previous.key === stableKey ? previous.draft : readStoredDraft(stableKey),
      );
      writeStoredDraft(stableKey, nextDraft);
      return {
        key: stableKey,
        draft: nextDraft,
      };
    });

  const updateQuestionDraft = (
    questionId: string,
    update: (previous: ClarifyQuestionDraft) => ClarifyQuestionDraft,
  ) =>
    updateDraft((previous) => {
      const previousQuestion =
        previous.answersByQuestionId[questionId] ?? initialQuestionDraft();
      return {
        ...previous,
        answersByQuestionId: {
          ...previous.answersByQuestionId,
          [questionId]: update(previousQuestion),
        },
      };
    });

  return {
    draft,
    canSubmit: draft.sendState === "idle" || draft.sendState === "checking",
    setCurrentQuestionIndex: (index: number) =>
      updateDraft((previous) => ({
        ...previous,
        currentQuestionIndex: Math.max(0, index),
        validationError: null,
      })),
    setSelectedOptionIds: (optionIds: readonly string[]) =>
      updateDraft((previous) => ({
        ...previous,
        selectedOptionIds: [...optionIds],
        validationError: null,
      })),
    setCustomText: (customText: string) =>
      updateDraft((previous) => ({
        ...previous,
        customText,
        validationError: null,
      })),
    setValidationError: (validationError: string | null) =>
      updateDraft((previous) => ({ ...previous, validationError })),
    answerForQuestion: (questionId: string) =>
      draft.answersByQuestionId[questionId] ?? initialQuestionDraft(),
    setQuestionAnswer: updateQuestionDraft,
    setQuestionValidationError: (
      questionId: string,
      validationError: string | null,
    ) =>
      updateQuestionDraft(questionId, (previous) => ({
        ...previous,
        validationError,
      })),
    markSending: () =>
      updateDraft((previous) => ({
        ...previous,
        sendState: "sending",
        validationError: null,
      })),
    markChecking: () =>
      updateDraft((previous) => ({ ...previous, sendState: "checking" })),
    markAnswered: () =>
      updateDraft((previous) => ({ ...previous, sendState: "answered" })),
  };
}
