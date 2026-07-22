import { useMemo, useState } from "react";

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
  sendState: "idle" | "sending" | "checking" | "answered";
};

export type ClarifyDraftController = {
  draft: ClarifyDraftState;
  canSubmit: boolean;
  setCurrentQuestionIndex: (index: number) => void;
  setSelectedOptionIds: (optionIds: readonly string[]) => void;
  setCustomText: (customText: string) => void;
  setValidationError: (validationError: string | null) => void;
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
    sendState: "idle",
  };
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
    draft: initialDraft(),
  }));
  const draft = state.key === stableKey ? state.draft : initialDraft();

  const updateDraft = (
    update: (previous: ClarifyDraftState) => ClarifyDraftState,
  ) =>
    setState((previous) => ({
      key: stableKey,
      draft: update(previous.key === stableKey ? previous.draft : initialDraft()),
    }));

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
