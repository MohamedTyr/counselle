import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { AtSign } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { FULL_SUBREDDIT_MENU } from "@/api/chat/source-config";
import type {
  CounselingMode,
  ResponseMode,
  ResponseModeOption,
  SourceConfig,
  Subreddit,
} from "@/api/chat/types";
import {
  modeLook,
  SOURCE_OPTIONS,
  SPEED_LOOKS,
  type SourceKey,
} from "@/features/ai-composer/run-settings-options";

/** Re-mounts when `id` changes, so a new value settles in rather than
 * snapping over the old one. */
export function SwapIn({ children, id }: { children: ReactNode; id: string }) {
  return (
    <span className="as-swap" key={id}>
      {children}
    </span>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="as-panel-section">
      <h3 className="as-panel-title">{title}</h3>
      {children}
    </section>
  );
}

type SegmentedOption = {
  value: string;
  label: string;
  short: string;
  icon: ReactNode;
};

type SegmentedProps = {
  label: string;
  onValueChange: (value: string) => void;
  options: readonly SegmentedOption[];
  value: string;
};

/** A segmented radio group whose white thumb slides to the chosen option. */
function Segmented({ label, onValueChange, options, value }: SegmentedProps) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <RadioGroup
      aria-label={label}
      className="as-segmented"
      onValueChange={(next) => onValueChange(String(next))}
      style={{ "--n": options.length, "--i": index } as CSSProperties}
      value={value}
    >
      <span aria-hidden="true" className="as-segmented-thumb" />
      {options.map((option) => (
        <Radio.Root
          aria-label={option.label}
          className="as-segmented-option"
          key={option.value}
          value={option.value}
        >
          {option.icon}
          <span>{option.short}</span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export type ModeSettings = {
  mode: CounselingMode;
  modes: readonly CounselingMode[];
  onModeChange: (mode: CounselingMode) => void;
};

export type SkillSettings = {
  canBrowse: boolean;
  onBrowse: () => void;
};

function ModeSection({
  mode,
  modes,
  onModeChange,
  skills,
}: ModeSettings & { skills: SkillSettings | null }) {
  return (
    <Section title="Answer style">
      <Segmented
        label="Counseling mode"
        onValueChange={(value) => {
          const selected = modes.find((entry) => entry.skillName === value);
          if (selected) {
            onModeChange(selected);
          }
        }}
        options={modes.map((entry) => {
          const look = modeLook(entry);
          const Icon = look.icon;
          return {
            value: entry.skillName,
            label: entry.displayName,
            short: look.short,
            icon: <Icon aria-hidden="true" className="as-segmented-icon" />,
          };
        })}
        value={mode.skillName}
      />
      {mode.description && (
        <p className="as-panel-caption as-panel-caption--mode">
          <SwapIn id={mode.skillName}>{mode.description}</SwapIn>
        </p>
      )}
      {skills && (
        <button
          className="as-panel-link"
          disabled={!skills.canBrowse}
          onClick={skills.onBrowse}
          type="button"
        >
          <AtSign aria-hidden="true" className="size-3.5" />
          {skills.canBrowse
            ? "More specialized skills…"
            : "Specialized skill limit reached"}
        </button>
      )}
    </Section>
  );
}

export type SourceSettings = {
  sourceConfig: SourceConfig;
  onSourceConfigChange: (config: SourceConfig) => void;
};

function SourcesSection({ onSourceConfigChange, sourceConfig }: SourceSettings) {
  function setSource(key: SourceKey) {
    onSourceConfigChange({ ...sourceConfig, [key]: !sourceConfig[key] });
  }

  function toggleSubreddit(subreddit: Subreddit) {
    const picked = sourceConfig.selectedSubreddits.includes(subreddit);
    onSourceConfigChange({
      ...sourceConfig,
      selectedSubreddits: picked
        ? sourceConfig.selectedSubreddits.filter((entry) => entry !== subreddit)
        : [...sourceConfig.selectedSubreddits, subreddit],
    });
  }

  return (
    <Section title="Look in">
      <div className="as-source-chips">
        {SOURCE_OPTIONS.map((source) => (
          <button
            aria-checked={sourceConfig[source.key]}
            aria-label={source.label}
            className="as-source-chip"
            key={source.key}
            onClick={() => setSource(source.key)}
            role="checkbox"
            type="button"
          >
            <img alt="" src={source.logo} />
            {source.short}
            {source.key === "reddit" && sourceConfig.reddit && (
              <span className="as-source-chip-count">
                {sourceConfig.selectedSubreddits.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        className="as-communities"
        data-open={sourceConfig.reddit}
        inert={!sourceConfig.reddit}
      >
        <div className="as-communities-inner">
          <div className="as-community-chips" role="group" aria-label="Reddit communities">
            {FULL_SUBREDDIT_MENU.map((subreddit) => (
              <button
                aria-checked={sourceConfig.selectedSubreddits.includes(subreddit)}
                aria-label={subreddit.replace(/^r\//, "")}
                className="as-community-chip"
                key={subreddit}
                onClick={() => toggleSubreddit(subreddit)}
                role="checkbox"
                type="button"
              >
                <span aria-hidden="true" className="as-community-prefix">
                  r/
                </span>
                {subreddit.replace(/^r\//, "")}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

export type SpeedSettings = {
  mode: ResponseMode;
  modes: readonly ResponseModeOption[];
  onModeChange: (mode: ResponseMode) => void;
};

function modelName(option: ResponseModeOption | undefined) {
  if (!option?.model) {
    return null;
  }
  return option.preview
    ? `${option.modelDisplayName} · Preview`
    : option.modelDisplayName;
}

function SpeedSection({ mode, modes, onModeChange }: SpeedSettings) {
  const model = modelName(modes.find((option) => option.id === mode));
  return (
    <Section title="Speed">
      <Segmented
        label="Response mode"
        onValueChange={(value) => {
          const next = modes.find((option) => option.id === value);
          if (next) {
            onModeChange(next.id);
          }
        }}
        options={modes.map((option) => {
          const look = SPEED_LOOKS[option.id];
          const Icon = look.icon;
          return {
            value: option.id,
            label: look.label,
            short: look.label,
            icon: <Icon aria-hidden="true" className="as-segmented-icon" />,
          };
        })}
        value={mode}
      />
      {model && (
        <p className="as-panel-caption">
          <SwapIn id={mode}>Runs on {model}</SwapIn>
        </p>
      )}
    </Section>
  );
}

export type RunSettingsPanelProps = {
  modeSettings: ModeSettings | null;
  skills: SkillSettings | null;
  sources: SourceSettings;
  speed: SpeedSettings | null;
};

export function RunSettingsPanel({
  modeSettings,
  skills,
  sources,
  speed,
}: RunSettingsPanelProps) {
  return (
    <div className="as-panel">
      {modeSettings && <ModeSection {...modeSettings} skills={skills} />}
      <SourcesSection {...sources} />
      {speed && <SpeedSection {...speed} />}
    </div>
  );
}
