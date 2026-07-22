import { useCallback, useRef, useState } from "react";

import { chatTransport } from "@/api/chat/transport";
import type {
  ChatTransport,
  ResponseMode,
  SourceConfig,
  StartTurnResult,
} from "@/api/chat/types";
import { isTransportError } from "@/api/http/errors";

type UseComposerStartTurnOptions = {
  transport?: ChatTransport;
};

export type UseComposerStartTurnResult = {
  submit: (
    text: string,
    sourceConfig: SourceConfig,
    responseMode: ResponseMode,
  ) => Promise<StartTurnResult>;
  cancel: () => Promise<void>;
  isSubmitting: boolean;
  canCancel: boolean;
  error: string | null;
};

function createUserMessage(error: unknown, fallback: string) {
  return isTransportError(error) ? error.message : fallback;
}

export function useComposerStartTurn({
  transport = chatTransport,
}: UseComposerStartTurnOptions = {}): UseComposerStartTurnResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (
      text: string,
      sourceConfig: SourceConfig,
      responseMode: ResponseMode,
    ): Promise<StartTurnResult> => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || submittingRef.current) {
        return { ok: false };
      }

      submittingRef.current = true;
      setIsSubmitting(true);
      setError(null);

      let created: Awaited<ReturnType<ChatTransport["createSession"]>>;
      try {
        created = await transport.createSession({
          sourceConfig,
          responseMode,
        });
        activeSessionIdRef.current = created.sessionId;
      } catch (cause) {
        setError(createUserMessage(cause, "Could not start the conversation."));
        submittingRef.current = false;
        setIsSubmitting(false);
        activeSessionIdRef.current = null;
        return { ok: false };
      }

      submittingRef.current = false;
      setIsSubmitting(false);
      activeSessionIdRef.current = null;
      return {
        ok: true,
        sessionId: created.sessionId,
        responseMode: created.responseMode,
      };
    },
    [transport],
  );

  const cancel = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    try {
      await transport.cancelActiveTurn(sessionId);
    } catch (cause) {
      setError(createUserMessage(cause, "Could not stop the response."));
    }
  }, [transport]);

  return {
    submit,
    cancel,
    isSubmitting,
    canCancel: false,
    error,
  };
}
