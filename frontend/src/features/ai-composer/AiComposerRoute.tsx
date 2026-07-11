import { useState } from "react"
import { useNavigate } from "react-router"

import type { SourceConfig } from "@/api/chat/types"
import {
  BUILT_IN_SOURCE_CONFIG,
} from "@/api/chat/source-config"
import { useChatConfig } from "@/api/chat/config"
import { AiComposer } from "@/features/ai-composer/AiComposer"
import { useComposerStartTurn } from "@/features/ai-composer/useComposerStartTurn"

export function AiComposerRoute() {
  const navigate = useNavigate()
  const configQuery = useChatConfig()
  const startTurn = useComposerStartTurn()
  const [value, setValue] = useState("")
  const [sourceConfigOverride, setSourceConfigOverride] =
    useState<SourceConfig | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const resolved = configQuery.config

  const sourceConfig =
    sourceConfigOverride ?? resolved?.sourceConfig ?? BUILT_IN_SOURCE_CONFIG

  async function submit() {
    const submitted = value.trim()
    if (submitted.length === 0) {
      return
    }

    const result = await startTurn.submit(submitted, sourceConfig)
    if (result.ok) {
      setValue("")
      setSelectedSkills([])
      void navigate(`/app/ai/${result.sessionId}`, {
        state: {
          initialTurn: {
            text: submitted,
            skills: [...selectedSkills],
          },
        },
      })
      return
    }
  }

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-4 py-8 md:px-8">
      <div className="flex w-full max-w-[700px] -translate-y-[4vh] flex-col items-center gap-10 md:gap-11">
        {resolved ? (
          <h1 className="max-w-[18ch] text-center text-[1.55rem] leading-[1.08] font-medium tracking-[-0.02em] text-balance text-foreground md:text-[2.2rem]">
            {resolved.greeting}
          </h1>
        ) : (
          <div
            aria-hidden="true"
            className="h-[4.25rem] w-full max-w-[26rem] rounded-lg bg-[var(--workspace-surface-raised)] md:h-[6.4rem]"
          />
        )}

        <AiComposer
          canCancel={startTurn.canCancel}
          disabled={!resolved}
          isSubmitting={startTurn.isSubmitting}
          onCancel={() => {
            void startTurn.cancel()
          }}
          onSourceConfigChange={setSourceConfigOverride}
          onSubmit={() => {
            void submit()
          }}
          onSelectedSkillsChange={setSelectedSkills}
          onValueChange={setValue}
          maxSelectedSkills={resolved?.maxSelectedSkills ?? 0}
          selectedSkills={selectedSkills}
          skills={resolved?.skills ?? []}
          sourceConfig={sourceConfig}
          value={value}
        />
        {startTurn.error ? (
          <p className="min-h-5 text-center text-sm text-destructive-foreground">
            {startTurn.error}
          </p>
        ) : (
          <span aria-hidden="true" className="min-h-5" />
        )}
      </div>
    </main>
  )
}
