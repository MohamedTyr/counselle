import { AtSign, Send, Square } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CounselingMode, SkillCatalogEntry, SourceConfig } from "@/api/chat/types";
import { CounselingModeMenu } from "@/features/ai-composer/CounselingModeMenu";
import { SourcesMenu } from "@/features/ai-composer/SourcesMenu";
import {
  hasInlineSkillMention,
  InlineSkillMentionLayer,
} from "@/features/skill-picker/InlineSkillMentionLayer";
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
  mode?: CounselingMode | null;
  modes?: readonly CounselingMode[];
  onModeChange?: (mode: CounselingMode) => void;
};

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
  mode = null,
  modes = [],
  onModeChange = () => undefined,
}: ChatComposerProps) {
  const [isComposing, setIsComposing] = useState(false);
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  const maxTaskSkills = mode
    ? Math.max(0, maxSelectedSkills - 1)
    : maxSelectedSkills;
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 74,
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
    maxSelectedSkills: maxTaskSkills,
    disabled:
      disabled || isSubmitting || awaitingClarify || maxTaskSkills === 0,
  });
  const placeholder = awaitingClarify
    ? CLARIFY_PLACEHOLDER
    : DEFAULT_PLACEHOLDER;
  const canSubmit = value.trim().length > 0 && !disabled;
  const canClickSend = canSubmit && !isSubmitting;
  const hasSkillMention = hasInlineSkillMention(value, selectedSkills);

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

  return (
    <form
      aria-label="Message Counselle"
      className="w-full"
      onSubmit={handleSubmit}
    >
      <div
        ref={composerRef}
        className="group flex min-h-28 w-full flex-col overflow-hidden rounded-2xl border border-[var(--workspace-composer-border)] bg-[var(--workspace-composer-surface)] text-card-foreground shadow-[0_1px_2px_color-mix(in_oklch,var(--shell-background)_60%,transparent)] transition-colors focus-within:border-[var(--workspace-composer-border-active)]"
      >
        <div className="relative">
          {hasSkillMention && (
            <InlineSkillMentionLayer
              scrollTop={textareaScrollTop}
              selectedSkills={selectedSkills}
              value={value}
            />
          )}
          <Textarea
            aria-activedescendant={picker.activeOptionId}
            aria-autocomplete="list"
            aria-controls={picker.isOpen ? picker.listboxId : undefined}
            aria-expanded={picker.isOpen}
            aria-label="Message Counselle"
            role="combobox"
            unstyled
            className={cn(
              "relative block w-full text-base leading-5 shadow-none outline-none [&_[data-slot=textarea]]:block [&_[data-slot=textarea]]:min-h-18.5 [&_[data-slot=textarea]]:max-h-55 [&_[data-slot=textarea]]:resize-none [&_[data-slot=textarea]]:overflow-y-auto [&_[data-slot=textarea]]:border-0 [&_[data-slot=textarea]]:bg-transparent [&_[data-slot=textarea]]:px-[var(--workspace-composer-inset)] [&_[data-slot=textarea]]:pb-3 [&_[data-slot=textarea]]:shadow-none [&_[data-slot=textarea]]:focus-visible:ring-0 [&_[data-slot=textarea]::placeholder]:text-[var(--workspace-composer-placeholder)]",
              "[&_[data-slot=textarea]]:text-[var(--workspace-composer-input-foreground)]",
              "[&_[data-slot=textarea]]:pt-[var(--workspace-composer-prompt-inset-block-start)]",
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
            onScroll={(event) =>
              setTextareaScrollTop(event.currentTarget.scrollTop)
            }
            onSelect={picker.handleTextareaSelect}
            placeholder={placeholder}
            ref={textareaRef}
            style={{ resize: "none" }}
            value={value}
          />
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 bg-[var(--workspace-composer-surface)] px-[var(--workspace-composer-inset)] pb-[var(--workspace-composer-toolbar-inset-block-end)]">
          <div className="flex flex-wrap items-center gap-1.5">
            {mode && modes.length > 0 ? (
              <CounselingModeMenu
                canBrowseSkills={selectedSkills.length < maxTaskSkills}
                disabled={disabled || isSubmitting || awaitingClarify}
                mode={mode}
                modes={modes}
                onBrowseSkills={picker.insertTrigger}
                onModeChange={onModeChange}
              />
            ) : maxSelectedSkills > 0 && !awaitingClarify ? (
              <Button
                aria-label="Add a skill (@)"
                className="size-8 !rounded-[var(--workspace-composer-control-radius)] !border-[var(--workspace-composer-control-border)] !bg-[var(--workspace-composer-control-surface)] !text-[var(--workspace-composer-sources-foreground)] !shadow-none before:!rounded-[calc(var(--workspace-composer-control-radius)-1px)] before:!shadow-none hover:!border-[var(--workspace-composer-control-hover-border)] hover:!bg-[var(--workspace-composer-control-hover-surface)] hover:!text-[var(--workspace-composer-sources-foreground)] data-pressed:!border-[var(--workspace-composer-control-hover-border)] data-pressed:!bg-[var(--workspace-composer-control-hover-surface)]"
                disabled={disabled || isSubmitting}
                onClick={picker.insertTrigger}
                size="icon"
                type="button"
                variant="outline"
              >
                <AtSign className="!mx-0 size-4" data-icon="inline-start" />
              </Button>
            ) : null}
            <SourcesMenu
              disabled={disabled || isSubmitting}
              onSourceConfigChange={onSourceConfigChange}
              sourceConfig={sourceConfig}
            />
          </div>

          {isSubmitting ? (
            <Button
              aria-label="Stop"
              className="size-9 shrink-0 rounded-[var(--workspace-composer-control-radius)]"
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
              className="size-9 shrink-0 rounded-[var(--workspace-composer-control-radius)]"
              disabled={!canClickSend}
              size="icon"
              type="submit"
            >
              <Send className="!mx-0 size-4" data-icon="inline-start" />
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
