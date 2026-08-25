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

type AiComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  sourceConfig: SourceConfig;
  onSourceConfigChange: (sourceConfig: SourceConfig) => void;
  responseMode?: ResponseMode;
  responseModes?: readonly ResponseModeOption[];
  onResponseModeChange?: (mode: ResponseMode) => void;
  onSubmit: () => void;
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
    onSubmit();
    adjustHeight(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
      </div>
    </form>
  );
}
