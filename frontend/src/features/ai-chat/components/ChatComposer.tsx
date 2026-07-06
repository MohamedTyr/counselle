import { Globe2, GraduationCap, MessageCircle, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FULL_SUBREDDIT_MENU } from "@/api/chat/source-config";
import type { SourceConfig, Subreddit } from "@/api/chat/types";
import { cn } from "@/lib/utils";

const DEFAULT_PLACEHOLDER = "Message Counselle";
const CLARIFY_PLACEHOLDER = "Pick one, or just type...";

export type ChatComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  sourceConfig: SourceConfig;
  onSourceConfigChange: (config: SourceConfig) => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
  isSubmitting: boolean;
  awaitingClarify: boolean;
  disabled?: boolean;
};

type SourceToggle = {
  key: "webSearch" | "eduSources" | "reddit";
  label: string;
  icon: typeof Globe2;
};

const sourceToggles: SourceToggle[] = [
  { key: "webSearch", label: "Web", icon: Globe2 },
  { key: "eduSources", label: ".edu", icon: GraduationCap },
  { key: "reddit", label: "Reddit", icon: MessageCircle },
];

function SubredditMenu({
  selected,
  onChange,
}: {
  selected: Subreddit[];
  onChange: (next: Subreddit[]) => void;
}) {
  const toggle = (subreddit: Subreddit) => {
    onChange(
      selected.includes(subreddit)
        ? selected.filter((entry) => entry !== subreddit)
        : [...selected, subreddit],
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-xs font-medium text-muted-foreground">
        Communities
      </span>
      <div className="flex flex-wrap gap-1.5 px-1">
        {FULL_SUBREDDIT_MENU.map((subreddit) => {
          const checked = selected.includes(subreddit);
          return (
            <button
              aria-pressed={checked}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                checked
                  ? "border-primary/40 bg-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent",
              )}
              key={subreddit}
              onClick={() => toggle(subreddit)}
              type="button"
            >
              {subreddit.replace(/^r\//, "")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ChatComposer — AI Elements `PromptInput` adapted to Counselle's chat turn
 * engine. `PromptInputTextarea` already implements the required keyboard
 * contract natively (Enter sends, Shift+Enter inserts a newline, IME
 * composition guarded) — see prompt-input.tsx's `handleKeyDown` — so no
 * keyboard logic is re-implemented here.
 */
export function ChatComposer({
  value,
  onValueChange,
  sourceConfig,
  onSourceConfigChange,
  onSubmit,
  onStop,
  isSubmitting,
  awaitingClarify,
  disabled = false,
}: ChatComposerProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const placeholder = awaitingClarify ? CLARIFY_PLACEHOLDER : DEFAULT_PLACEHOLDER;

  function patchSource(key: SourceToggle["key"]) {
    onSourceConfigChange({ ...sourceConfig, [key]: !sourceConfig[key] });
  }

  return (
    <PromptInput
      aria-label="Message Counselle"
      onSubmit={(message, event) => {
        event.preventDefault();
        onSubmit(message.text);
      }}
    >
      <PromptInputTextarea
        disabled={disabled}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
      <PromptInputTools className="justify-between px-2 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {sourceToggles.map((toggle) => {
            const Icon = toggle.icon;
            const pressed = sourceConfig[toggle.key];
            return (
              <Button
                aria-label={toggle.label}
                aria-pressed={pressed}
                className={cn(
                  "h-7 rounded-full px-2 text-xs font-medium",
                  pressed ? "bg-accent text-foreground" : "text-muted-foreground",
                )}
                disabled={disabled}
                key={toggle.key}
                onClick={() => patchSource(toggle.key)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icon className="size-3.5" data-icon="inline-start" />
                {toggle.label}
              </Button>
            );
          })}
          {sourceConfig.reddit && (
            <Popover onOpenChange={setSourcesOpen} open={sourcesOpen}>
              <PopoverTrigger
                aria-label="Choose subreddits"
                className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <SlidersHorizontal className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64" side="top">
                <SubredditMenu
                  onChange={(next) =>
                    onSourceConfigChange({ ...sourceConfig, selectedSubreddits: next })
                  }
                  selected={sourceConfig.selectedSubreddits}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
        <PromptInputSubmit
          disabled={disabled || (!isSubmitting && value.trim().length === 0)}
          onStop={onStop}
          status={isSubmitting ? "streaming" : undefined}
        />
      </PromptInputTools>
    </PromptInput>
  );
}
