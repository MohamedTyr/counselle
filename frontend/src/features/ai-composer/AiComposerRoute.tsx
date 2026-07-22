import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { SourceConfig } from "@/api/chat/types";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import { useChatConfig } from "@/api/chat/config";
import { AiComposer } from "@/features/ai-composer/AiComposer";
import {
  findCounselingMode,
  mergeModeAndTaskSkills,
} from "@/features/ai-composer/counseling-mode";
import { parseDraftPromptState } from "@/features/ai-composer/draft-prompt";
import { useComposerStartTurn } from "@/features/ai-composer/useComposerStartTurn";

export function AiComposerRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const configQuery = useChatConfig();
  const startTurn = useComposerStartTurn();
  // Hydrate from an onboarding-handoff draft prompt (plan §20.7) via the
  // lazy `useState` initializer, not an effect: it only needs to run once,
  // reading `location.state` as it existed at mount.
  const [value, setValue] = useState(
    () => parseDraftPromptState(location.state) ?? "",
  );
  const [sourceConfigOverride, setSourceConfigOverride] =
    useState<SourceConfig | null>(null);
  const [selectedModeSkill, setSelectedModeSkill] = useState<string | null>(
    null,
  );
  const [selectedTaskSkills, setSelectedTaskSkills] = useState<string[]>([]);
  const resolved = configQuery.config;
  const hasClearedDraftStateRef = useRef(false);

  useEffect(() => {
    if (hasClearedDraftStateRef.current) return;
    hasClearedDraftStateRef.current = true;
    if (!parseDraftPromptState(location.state)) return;
    // Clear the router state once it's been read so a refresh or Back
    // navigation never re-applies it over whatever the student has since
    // typed (plan §20.7). This never submits anything — only Send does.
    void navigate(location.pathname, { replace: true, state: null });
    // Intentionally runs once on mount only: `location`/`navigate` are read
    // for their value at that moment, not tracked as reactive dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sourceConfig =
    sourceConfigOverride ?? resolved?.sourceConfig ?? BUILT_IN_SOURCE_CONFIG;
  const selectedMode =
    resolved == null
      ? null
      : (findCounselingMode(resolved.skillModes, selectedModeSkill) ??
        resolved.defaultSkillMode);

  async function submit() {
    const submitted = value.trim();
    if (submitted.length === 0) {
      return;
    }

    const submittedSkills = mergeModeAndTaskSkills(
      selectedMode?.skillName,
      selectedTaskSkills,
    );
    const result = await startTurn.submit(submitted, sourceConfig);
    if (result.ok) {
      setValue("");
      setSelectedTaskSkills([]);
      void navigate(`/app/ai/${result.sessionId}`, {
        state: {
          initialTurn: {
            text: submitted,
            skills: submittedSkills,
          },
        },
      });
      return;
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
            void startTurn.cancel();
          }}
          onSourceConfigChange={setSourceConfigOverride}
          onSubmit={() => {
            void submit();
          }}
          onModeChange={(mode) => setSelectedModeSkill(mode.skillName)}
          onSelectedSkillsChange={setSelectedTaskSkills}
          onValueChange={setValue}
          maxSelectedSkills={resolved?.maxSelectedSkills ?? 0}
          mode={selectedMode}
          modes={resolved?.skillModes ?? []}
          selectedSkills={selectedTaskSkills}
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
  );
}
