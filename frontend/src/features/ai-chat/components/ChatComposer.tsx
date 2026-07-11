import { AtSign, Globe2, GraduationCap, MessageCircle, Send, SlidersHorizontal, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { FULL_SUBREDDIT_MENU } from "@/api/chat/source-config";
import type { SkillCatalogEntry, SourceConfig, Subreddit } from "@/api/chat/types";
import { SelectedSkillChips } from "@/features/skill-picker/SelectedSkillChips";
import { SkillPicker } from "@/features/skill-picker/SkillPicker";
import { useSkillPicker } from "@/features/skill-picker/useSkillPicker";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
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
  skills?: readonly SkillCatalogEntry[];
  selectedSkills?: readonly string[];
  onSelectedSkillsChange?: (skills: string[]) => void;
  maxSelectedSkills?: number;
};

type SourceToggle = {
  key: "webSearch" | "eduSources" | "reddit";
  label: string;
  shortLabel: string;
  icon: typeof Globe2;
};

const sourceToggles: SourceToggle[] = [
  { key: "webSearch", label: "Web search", shortLabel: "Web", icon: Globe2 },
  { key: "eduSources", label: ".edu sources", shortLabel: ".edu", icon: GraduationCap },
  { key: "reddit", label: "Reddit communities", shortLabel: "Reddit", icon: MessageCircle },
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
  skills = [],
  selectedSkills = [],
  onSelectedSkillsChange = () => undefined,
  maxSelectedSkills = 0,
}: ChatComposerProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 34,
    maxHeight: 220,
  });
  const composerRef = useRef<HTMLDivElement>(null);
  const picker = useSkillPicker({
    text: value,
    onTextChange: onValueChange,
    textareaRef,
    catalog: skills,
    selectedSkills,
    onSelectedSkillsChange,
    maxSelectedSkills,
    disabled:
      disabled || isSubmitting || awaitingClarify || maxSelectedSkills === 0,
  });
  const placeholder = awaitingClarify ? CLARIFY_PLACEHOLDER : DEFAULT_PLACEHOLDER;
  const canSubmit = value.trim().length > 0 && !disabled;
  const canClickSend = canSubmit && !isSubmitting;
  const hasValue = value.trim().length > 0;

  useEffect(() => {
    adjustHeight(value.length === 0);
  }, [adjustHeight, value]);

  function submitText(text: string) {
    if (text.trim().length === 0 || disabled) {
      return;
    }

    onSubmit(text);
    adjustHeight(true);
  }

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    submitText(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (picker.handleKeyDown(event)) {
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    if (isComposing || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    submitText(event.currentTarget.value);
  }

  function patchSource(key: SourceToggle["key"]) {
    onSourceConfigChange({ ...sourceConfig, [key]: !sourceConfig[key] });
  }

  return (
    <form
      aria-label="Message Counselle"
      className="w-full"
      onSubmit={handleSubmit}
    >
      <div
        ref={composerRef}
        className={cn(
          "group flex min-h-28 w-full flex-col overflow-hidden rounded-2xl transition-colors",
          "bg-[#1e1d1c] text-card-foreground",
          hasValue
            ? "border border-[#434240] focus-within:border-[#434240]"
            : "border border-[#383736] focus-within:border-[#434240]",
        )}
      >
        <SelectedSkillChips
          catalog={skills}
          disabled={disabled || isSubmitting}
          onRemove={picker.removeSelectedSkill}
          selectedSkills={selectedSkills}
        />
        <Textarea
          aria-activedescendant={picker.activeOptionId}
          aria-autocomplete="list"
          aria-controls={picker.isOpen ? picker.listboxId : undefined}
          aria-expanded={picker.isOpen}
          aria-label="Message Counselle"
          role="combobox"
          unstyled
          className={cn(
            "min-h-10 max-h-18 w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1.5 text-base leading-5 shadow-none outline-none",
            "placeholder:text-[var(--workspace-foreground-soft)] focus-visible:ring-0 md:px-4 md:pt-2.5",
          )}
          disabled={disabled}
          onChange={(event) => {
            picker.handleTextChange(event);
            adjustHeight();
          }}
          onCompositionEnd={(event) => {
            setIsComposing(false);
            picker.handleCompositionEnd(event);
          }}
          onCompositionStart={() => {
            setIsComposing(true);
            picker.handleCompositionStart();
          }}
          onKeyDown={handleKeyDown}
          onSelect={picker.handleTextareaSelect}
          placeholder={placeholder}
          ref={textareaRef}
          style={{ resize: "none" }}
          value={value}
        />

        <div className="mt-auto flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-[var(--workspace-border-soft)] px-3 py-2.5 md:px-4">
          <div className="flex flex-wrap items-center gap-2">
            {maxSelectedSkills > 0 && !awaitingClarify && (
              <Button
                aria-label="Add a skill (@)"
                className="size-8 rounded-lg"
                disabled={disabled || isSubmitting}
                onClick={picker.insertTrigger}
                size="icon"
                type="button"
                variant="outline"
              >
                <AtSign data-icon="inline-start" />
              </Button>
            )}
            {sourceToggles.map((toggle) => {
              const Icon = toggle.icon;
              const pressed = sourceConfig[toggle.key];
              return (
                <Button
                  aria-label={toggle.label}
                  aria-pressed={pressed}
                  className={cn(
                    "h-8 rounded-lg px-2.5 text-xs font-medium",
                    pressed
                      ? "border-[var(--workspace-upcoming-task-card-hover-border)] bg-[var(--workspace-surface-active)] text-foreground"
                      : "text-muted-foreground",
                  )}
                  disabled={disabled || isSubmitting}
                  key={toggle.key}
                  onClick={() => patchSource(toggle.key)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icon data-icon="inline-start" />
                  <span aria-hidden="true" className="hidden sm:inline">
                    {toggle.label}
                  </span>
                  <span aria-hidden="true" className="sm:hidden">
                    {toggle.shortLabel}
                  </span>
                </Button>
              );
            })}
            {sourceConfig.reddit && (
              <Popover onOpenChange={setSourcesOpen} open={sourcesOpen}>
              <PopoverTrigger
                aria-label="Choose subreddits"
                className="flex size-8 items-center justify-center rounded-lg border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
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

          {isSubmitting ? (
            <Button
              aria-label="Stop"
              className="size-9 shrink-0 rounded-lg"
              onClick={onStop}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Square data-icon="inline-start" />
            </Button>
          ) : (
            <Button
              aria-label="Send"
              className="size-9 shrink-0 rounded-lg"
              disabled={!canClickSend}
              size="icon"
              type="submit"
            >
              <Send data-icon="inline-start" />
            </Button>
          )}
        </div>
        <SkillPicker
          activeIndex={picker.activeIndex}
          anchorRef={composerRef}
          announcement={picker.announcement}
          isOpen={picker.isOpen}
          listboxId={picker.listboxId}
          onClose={picker.close}
          onSelect={picker.selectSkill}
          query={picker.query}
          results={picker.results}
          selectedSkills={selectedSkills}
          setActiveIndex={picker.setActiveIndex}
        />
      </div>
    </form>
  );
}
