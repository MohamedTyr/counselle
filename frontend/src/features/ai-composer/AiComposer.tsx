import { AtSign, Send, Square, Target, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import { cn } from "@/lib/utils";
import {
  BUILT_IN_DEFAULT_RESPONSE_MODE,
  BUILT_IN_RESPONSE_MODE_OPTIONS,
} from "@/api/chat/response-mode";
import type {
  CounselingMode,
  ResponseMode,
  ResponseModeOption,
  SkillCatalogEntry,
  SourceConfig,
} from "@/api/chat/types";
import {
  composerControlIconButtonClass,
  composerSendButtonClass,
} from "@/features/ai-composer/composer-control";
import { CounselingModeMenu } from "@/features/ai-composer/CounselingModeMenu";
import { ResponseModeMenu } from "@/features/ai-composer/ResponseModeMenu";
import { SourcesMenu } from "@/features/ai-composer/SourcesMenu";
import {
  hasInlineSkillMention,
  InlineSkillMentionLayer,
} from "@/features/skill-picker/InlineSkillMentionLayer";
import { SkillPicker } from "@/features/skill-picker/SkillPicker";
import { useSkillPicker } from "@/features/skill-picker/useSkillPicker";
import { SlashCommandMenu } from "@/features/slash-command/SlashCommandMenu";
import { useSlashCommand } from "@/features/slash-command/useSlashCommand";

type AiComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  sourceConfig: SourceConfig;
  onSourceConfigChange: (sourceConfig: SourceConfig) => void;
  responseMode?: ResponseMode;
  responseModes?: readonly ResponseModeOption[];
  onResponseModeChange?: (mode: ResponseMode) => void;
  onSubmit: () => void;
  /**
   * Fired immediately before `onSubmit` on every send, carrying whether goal
   * mode is armed for this message (goal-mode plan §5.5). `true` only when
   * the student explicitly selected `/goal` from the slash-command menu —
   * never derived from the raw text, so typing the literal string `/goal`
   * and sending it never arms an autonomous, budget-spending run. A
   * separate callback rather than an `onSubmit` argument, matching
   * `ChatComposer` (see its doc comment for why).
   */
  onGoalModeSubmit?: (goalMode: boolean) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  canCancel: boolean;
  disabled?: boolean;
  skills?: readonly SkillCatalogEntry[];
  selectedSkills?: readonly string[];
  onSelectedSkillsChange?: (skills: string[]) => void;
  maxSelectedSkills?: number;
  mode?: CounselingMode | null;
  modes?: readonly CounselingMode[];
  onModeChange?: (mode: CounselingMode) => void;
};

export function AiComposer({
  value,
  onValueChange,
  sourceConfig,
  onSourceConfigChange,
  responseMode = BUILT_IN_DEFAULT_RESPONSE_MODE,
  responseModes = BUILT_IN_RESPONSE_MODE_OPTIONS,
  onResponseModeChange = () => undefined,
  onSubmit,
  onGoalModeSubmit = () => undefined,
  onCancel,
  isSubmitting,
  canCancel,
  disabled = false,
  skills = [],
  selectedSkills = [],
  onSelectedSkillsChange = () => undefined,
  maxSelectedSkills = 0,
  mode = null,
  modes = [],
  onModeChange = () => undefined,
}: AiComposerProps) {
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
    disabled: disabled || isSubmitting || maxTaskSkills === 0,
  });
  const slash = useSlashCommand({
    text: value,
    onTextChange: onValueChange,
    textareaRef,
    disabled: disabled || isSubmitting,
  });
  const goalArmed = slash.armedCommandId === "goal";
  const canSubmit = value.trim().length > 0 && !isSubmitting && !disabled;
  const hasSkillMention = hasInlineSkillMention(value, selectedSkills);

  useEffect(() => {
    adjustHeight(value.length === 0);
  }, [adjustHeight, value]);

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) {
      return;
    }
    onGoalModeSubmit(goalArmed);
    onSubmit();
    // Every send clears the armed command, so a later, unrelated message can
    // never silently inherit goal mode (§5.5).
    slash.clearArmedCommand();
    adjustHeight(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Chained slash → skill → submit (§5.5): both return `true` when they
    // consume a key, so first refusal wins and nothing falls through.
    if (slash.handleKeyDown(event)) {
      return;
    }
    if (picker.handleKeyDown(event)) {
      return;
    }
    if (isComposing || event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form
      aria-label="Start an AI conversation"
      className="w-full"
      onSubmit={handleSubmit}
    >
      <div
        ref={composerRef}
        className="group flex min-h-28 w-full flex-col overflow-hidden rounded-2xl border border-[var(--workspace-composer-border)] bg-[var(--workspace-composer-surface)] text-card-foreground transition-[border-color,box-shadow] focus-within:border-[var(--workspace-composer-border-active)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]/30 motion-reduce:transition-none"
      >
        {goalArmed && (
          <div className="flex px-[var(--workspace-composer-inset)] pt-3">
            <Badge
              className="min-w-0 max-w-full gap-1.5 py-0.5 pr-1 pl-2 font-normal"
              variant="outline"
            >
              <Target aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">Goal mode</span>
              <button
                aria-label="Cancel goal mode"
                className="-mr-0.5 relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11"
                onClick={slash.clearArmedCommand}
                type="button"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </Badge>
          </div>
        )}

        <div className="relative">
          {hasSkillMention && (
            <InlineSkillMentionLayer
              scrollTop={textareaScrollTop}
              selectedSkills={selectedSkills}
              value={value}
            />
          )}
          <Textarea
            aria-activedescendant={
              slash.isOpen ? slash.activeOptionId : picker.activeOptionId
            }
            aria-autocomplete="list"
            aria-controls={
              slash.isOpen
                ? slash.listboxId
                : picker.isOpen
                  ? picker.listboxId
                  : undefined
            }
            aria-expanded={slash.isOpen || picker.isOpen}
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
              slash.handleTextChange(event);
              picker.handleTextChange(event);
              adjustHeight();
            }}
            onCompositionEnd={(event) => {
              setIsComposing(false);
              slash.handleCompositionEnd(event);
              picker.handleCompositionEnd(event);
            }}
            onCompositionStart={() => {
              setIsComposing(true);
              slash.handleCompositionStart();
              picker.handleCompositionStart();
            }}
            onKeyDown={handleKeyDown}
            onScroll={(event) =>
              setTextareaScrollTop(event.currentTarget.scrollTop)
            }
            onSelect={(event) => {
              slash.handleTextareaSelect(event);
              picker.handleTextareaSelect(event);
            }}
            placeholder="Message Counselle"
            ref={textareaRef}
            style={{ resize: "none" }}
            value={value}
          />
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 bg-[var(--workspace-composer-surface)] px-[var(--workspace-composer-inset)] pb-[var(--workspace-composer-toolbar-inset-block-end)]">
          {/* gap-2 (8px), not gap-1.5: at 6px the chips sat closer to each
              other than their own 8-10px side padding, so the three read as
              one segmented control instead of three separate menus. */}
          <div className="flex flex-wrap items-center gap-2">
            {mode && modes.length > 0 ? (
              <CounselingModeMenu
                canBrowseSkills={selectedSkills.length < maxTaskSkills}
                disabled={disabled || isSubmitting}
                mode={mode}
                modes={modes}
                onBrowseSkills={picker.insertTrigger}
                onModeChange={onModeChange}
              />
            ) : maxSelectedSkills > 0 ? (
              <Button
                aria-label="Add a skill (@)"
                className={composerControlIconButtonClass}
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
            <ResponseModeMenu
              disabled={disabled || isSubmitting}
              mode={responseMode}
              modes={responseModes}
              onModeChange={onResponseModeChange}
            />
          </div>

          {canCancel ? (
            <Button
              aria-label="Stop response"
              className={cn("size-9", composerSendButtonClass)}
              onClick={onCancel}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Square data-icon="inline-start" />
            </Button>
          ) : (
            <Button
              aria-label="Send message"
              className={cn("size-9", composerSendButtonClass)}
              disabled={!canSubmit}
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
        <SlashCommandMenu
          activeIndex={slash.activeIndex}
          anchorRef={composerRef}
          announcement={slash.announcement}
          isOpen={slash.isOpen}
          listboxId={slash.listboxId}
          onClose={slash.close}
          onSelect={slash.selectCommand}
          query={slash.query}
          results={slash.results}
          setActiveIndex={slash.setActiveIndex}
        />
      </div>
    </form>
  );
}
