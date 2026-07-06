import { useCallback, useRef, useState } from "react"

import { chatTransport } from "@/api/chat/transport"
import type {
  ChatTransport,
  SourceConfig,
  StartTurnResult,
} from "@/api/chat/types"
import { isTransportError } from "@/api/http/errors"

type UseComposerStartTurnOptions = {
  transport?: ChatTransport
}

export type UseComposerStartTurnResult = {
  submit: (text: string, sourceConfig: SourceConfig) => Promise<StartTurnResult>
  cancel: () => Promise<void>
  isSubmitting: boolean
  canCancel: boolean
  error: string | null
}

function createUserMessage(error: unknown, fallback: string) {
  return isTransportError(error) ? error.message : fallback
}

export function useComposerStartTurn({
  transport = chatTransport,
}: UseComposerStartTurnOptions = {}): UseComposerStartTurnResult {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [canCancel, setCanCancel] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const submittingRef = useRef(false)

  const submit = useCallback(
    async (text: string, sourceConfig: SourceConfig) => {
      const trimmed = text.trim()
      if (trimmed.length === 0 || submittingRef.current) {
        return { ok: false }
      }

      submittingRef.current = true
      setIsSubmitting(true)
      setError(null)

      let sessionId: string
      try {
        const created = await transport.createSession({ sourceConfig })
        sessionId = created.sessionId
        activeSessionIdRef.current = sessionId
      } catch (cause) {
        setError(createUserMessage(cause, "Could not start the conversation."))
        submittingRef.current = false
        setIsSubmitting(false)
        activeSessionIdRef.current = null
        return { ok: false }
      }

      const controller = new AbortController()
      abortControllerRef.current = controller
      setCanCancel(true)

      try {
        await transport.streamFirstMessage({
          sessionId,
          text: trimmed,
          sourceConfig,
          signal: controller.signal,
        })
        return { ok: true, sessionId }
      } catch (cause) {
        if (controller.signal.aborted) {
          return { ok: true, sessionId }
        }
        setError(createUserMessage(cause, "Could not send that message."))
        return { ok: false }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
        }
        submittingRef.current = false
        setIsSubmitting(false)
        setCanCancel(false)
        activeSessionIdRef.current = null
      }
    },
    [transport],
  )

  const cancel = useCallback(async () => {
    const sessionId = activeSessionIdRef.current
    const controller = abortControllerRef.current
    if (!sessionId || !controller) {
      return
    }

    controller.abort()
    try {
      await transport.cancelActiveTurn(sessionId)
    } catch (cause) {
      setError(createUserMessage(cause, "Could not stop the response."))
    }
  }, [transport])

  return {
    submit,
    cancel,
    isSubmitting,
    canCancel,
    error,
  }
}
