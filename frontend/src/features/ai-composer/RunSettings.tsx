import { Popover } from "@base-ui/react/popover";
import { AtSign } from "lucide-react";
import { useState } from "react";

import {
  enabledSourceCount,
  modeLook,
  SPEED_LOOKS,
} from "@/features/ai-composer/run-settings-options";
import {
  RunSettingsPanel,
  SwapIn,
  type ModeSettings,
  type SkillSettings,
  type SourceSettings,
  type SpeedSettings,
} from "@/features/ai-composer/RunSettingsPanel";

type RunSettingsProps = {
  disabled: boolean;
  modeSettings: ModeSettings | null;
  skills: SkillSettings | null;
  sources: SourceSettings;
  speed: SpeedSettings | null;
};

/** Three short bars, filled to how far the mode digs. */
function DepthMeter({ depth }: { depth: number }) {
  return (
    <span aria-hidden="true" className="as-meter" data-depth={depth}>
      <b />
      <b />
      <b />
    </span>
  );
}

/** The composer's run settings as one pill of readings: how deep the mode
 * digs, how many sources it looks in, and how fast it answers. Clicking
 * it opens one panel holding all three. */
export function RunSettings({
  disabled,
  modeSettings,
  skills,
  sources,
  speed,
}: RunSettingsProps) {
  const [open, setOpen] = useState(false);
  const sourceCount = enabledSourceCount(sources.sourceConfig);
  const mode = modeSettings?.mode;
  const look = mode ? modeLook(mode) : null;
  const speedLook = speed ? SPEED_LOOKS[speed.mode] : null;
  const summary = [
    mode?.displayName,
    `${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`,
    speedLook?.label,
  ]
    .filter(Boolean)
    .join(", ");

  const browseSkills = skills && {
    ...skills,
    onBrowse: () => {
      setOpen(false);
      window.setTimeout(skills.onBrowse, 0);
    },
  };

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        aria-label={`Run settings: ${summary}`}
        className="as-run-settings"
        disabled={disabled}
      >
        {look && mode && (
          <span className="as-reading">
            <SwapIn id={mode.skillName}>{look.short}</SwapIn>
            <DepthMeter depth={look.depth} />
          </span>
        )}
        <span className="as-reading">
          Sources
          <span
            aria-hidden="true"
            className="as-count"
            data-zero={sourceCount === 0 || undefined}
          >
            <SwapIn id={String(sourceCount)}>{sourceCount}</SwapIn>
          </span>
        </span>
        {speed && speedLook && (
          <span className="as-reading" data-speed={speed.mode}>
            <SwapIn id={speed.mode}>
              {speedLook.label}
              <speedLook.icon aria-hidden="true" className="as-speed-icon" />
            </SwapIn>
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          className="as-positioner"
          side="top"
          sideOffset={10}
        >
          <Popover.Popup className="as-menu as-panel-popup">
            <RunSettingsPanel
              modeSettings={modeSettings}
              skills={browseSkills}
              sources={sources}
              speed={speed}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

type SkillTriggerProps = {
  disabled: boolean;
  onClick: () => void;
};

/** Sits beside the pill when skills exist but no modes do. */
export function SkillTrigger({ disabled, onClick }: SkillTriggerProps) {
  return (
    <button
      aria-label="Add a skill (@)"
      className="as-skill-trigger"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <AtSign aria-hidden="true" className="size-[14px]" />
    </button>
  );
}

type GoalModeToggleProps = {
  disabled: boolean;
  on: boolean;
  onToggle: () => void;
};

/** A two-position switch: on, the knob sits left in its green-rimmed
 * state; off, it slides right and sinks into the track. */
export function GoalModeToggle({ disabled, on, onToggle }: GoalModeToggleProps) {
  return (
    <button
      aria-checked={on}
      className="as-goal"
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span className="as-goal-knob">Goal mode</span>
    </button>
  );
}
