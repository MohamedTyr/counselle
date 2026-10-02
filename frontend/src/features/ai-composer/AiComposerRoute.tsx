import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { ResponseMode, SourceConfig } from "@/api/chat/types";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import {
  BUILT_IN_DEFAULT_RESPONSE_MODE,
  normalizeResponseModeSelection,
} from "@/api/chat/response-mode";
import { useChatConfig } from "@/api/chat/config";
import { useAuthUser } from "@/app/auth";
import { AiComposer } from "@/features/ai-composer/AiComposer";
import {
  findCounselingMode,
  mergeModeAndTaskSkills,
} from "@/features/ai-composer/counseling-mode";
import { parseDraftPromptState } from "@/features/ai-composer/draft-prompt";
import { useComposerStartTurn } from "@/features/ai-composer/useComposerStartTurn";

function timeOfDayGreeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function greetingFor(name: string | null | undefined, now: Date) {
  const greeting = timeOfDayGreeting(now.getHours());
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? `${greeting}, ${firstName}` : greeting;
}

export function AiComposerRoute() {
  const user = useAuthUser();
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
  const [responseModeOverride, setResponseModeOverride] =
    useState<ResponseMode | null>(null);
  const [selectedModeSkill, setSelectedModeSkill] = useState<string | null>(
    null,
  );
  const [selectedTaskSkills, setSelectedTaskSkills] = useState<string[]>([]);
  const resolved = configQuery.config;
  const hasClearedDraftStateRef = useRef(false);
  /**
   * Set only by `AiComposer`'s `onGoalModeSubmit`, which fires immediately
   * before `onSubmit` on every send and carries `true` only when the
   * student explicitly selected `/goal` from the slash-command menu (never
   * derived from typed text). `submit()` reads and clears this
   * synchronously for the one send it belongs to, so a later, unrelated
   * send never inherits a stale `true`.
   */
  const pendingGoalModeRef = useRef(false);

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
  // The visible selector owns only the next new-turn preference; final
  // execution still uses the server-confirmed mode returned by session create.
  const responseModeCapability = resolved
    ? {
        defaultResponseMode: resolved.defaultResponseMode,
        responseModes: resolved.responseModes,
      }
    : {
        defaultResponseMode: BUILT_IN_DEFAULT_RESPONSE_MODE,
        responseModes: [],
      };
  const responseMode = resolved
    ? normalizeResponseModeSelection(
        responseModeOverride ?? resolved.defaultResponseMode,
        responseModeCapability,
      ).mode
    : BUILT_IN_DEFAULT_RESPONSE_MODE;
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

    // Read-then-clear, synchronously, before anything async: this send owns
    // whatever value `onGoalModeSubmit` just set (or the default `false`
    // when this call didn't come from a composer send). Clearing immediately
    // means a later, unrelated send can never inherit it.
    const goalMode = pendingGoalModeRef.current;
    pendingGoalModeRef.current = false;

    const submittedSkills = mergeModeAndTaskSkills(
      selectedMode?.skillName,
      selectedTaskSkills,
    );
    const result = await startTurn.submit(
      submitted,
      sourceConfig,
      responseMode,
      goalMode,
    );
    if (result.ok) {
      setValue("");
      setSelectedTaskSkills([]);
      void navigate(`/app/ai/${result.sessionId}`, {
        state: {
          initialTurn: {
            text: submitted,
            skills: submittedSkills,
            responseMode: result.responseMode,
            goalMode: result.goalMode,
          },
        },
      });
      return;
    }
  }

  return (
    <main className="as-empty">
      <div className="as-empty-stack">
        <h1 className="as-greeting">{greetingFor(user?.name, new Date())}</h1>

        <AiComposer
          canCancel={startTurn.canCancel}
          disabled={!resolved}
          isSubmitting={startTurn.isSubmitting}
          onCancel={() => {
            void startTurn.cancel();
          }}
          onResponseModeChange={setResponseModeOverride}
          onSourceConfigChange={setSourceConfigOverride}
          onModeChange={(mode) => setSelectedModeSkill(mode.skillName)}
          onGoalModeSubmit={(armed) => {
            pendingGoalModeRef.current = armed;
          }}
          onSubmit={() => {
            void submit();
          }}
          onSelectedSkillsChange={setSelectedTaskSkills}
          onValueChange={setValue}
          maxSelectedSkills={resolved?.maxSelectedSkills ?? 0}
          mode={selectedMode}
          modes={resolved?.skillModes ?? []}
          selectedSkills={selectedTaskSkills}
          skills={resolved?.skills ?? []}
          sourceConfig={sourceConfig}
          responseMode={responseMode}
          responseModes={resolved?.responseModes ?? []}
          value={value}
        />
        {startTurn.error && (
          <p className="absolute top-full mt-3 text-center text-sm text-destructive-foreground">
            {startTurn.error}
          </p>
        )}
      </div>
    </main>
  );
}
