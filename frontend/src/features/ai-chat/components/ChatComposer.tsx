import { AtSign, Send, Square, TextQuote, X } from "lucide-react";
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
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import { cn } from "@/lib/utils";

const DEFAULT_PLACEHOLDER = "Message Counselle";
const CLARIFY_PLACEHOLDER = "Answer above, or reply in your own words...";
const CLARIFY_HELPER = "Answering the question above";

export type ChatComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  sourceConfig: SourceConfig;
  onSourceConfigChange: (config: SourceConfig) => void;
  responseMode?: ResponseMode;
  responseModes?: readonly ResponseModeOption[];
  onResponseModeChange?: (mode: ResponseMode) => void;
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
  /**
   * Essay-panel only: an essay turn is not deep-research-eligible, so the
   * response-mode picker is not offered. The toolbar row already wraps, so
   * one fewer chip needs no other change.
   */
  hideResponseMode?: boolean;
  /**
   * Essay-panel only: the text the student has selected in the document,
   * shown as a removable chip so it is obvious what the next turn will be
   * about. `undefined`/`null` renders nothing, which is every main-chat turn.
   */
  selectionChip?: string | null;
  onClearSelection?: () => void;
};

export function ChatComposer({
  value,
  onValueChange,
  sourceConfig,
  onSourceConfigChange,
  responseMode = BUILT_IN_DEFAULT_RESPONSE_MODE,
  responseModes = BUILT_IN_RESPONSE_MODE_OPTIONS,
  onResponseModeChange = () => undefined,
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
  hideResponseMode = false,
  selectionChip = null,
  onClearSelection,
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
        className={cn(
          "group flex w-full flex-col overflow-hidden rounded-2xl border border-[var(--workspace-composer-border)] bg-[var(--workspace-composer-surface)] text-card-foreground transition-[border-color,box-shadow] focus-within:border-[var(--workspace-composer-border-active)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]/30 motion-reduce:transition-none",
          awaitingClarify ? "min-h-0" : "min-h-28",
        )}
      >
        {selectionChip !== null && selectionChip !== "" && (
          /*
           * Above the message, not below it among the settings chips: what the
           * student highlighted is the subject of the sentence they are about
           * to write, not a third preference sitting beside "Sources". Reuses
           * `Badge` rather than a bespoke chip — it is the same "something
           * scoped is attached to this turn" claim the citation chip makes.
           */
          <div className="flex px-[var(--workspace-composer-inset)] pt-3">
            <Badge
              className="min-w-0 max-w-full gap-1.5 py-0.5 pr-1 pl-2 font-normal"
              variant="outline"
            >
              <TextQuote aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{selectionChip}</span>
              <button
                aria-label="Clear the selected text"
                /* Not a `Button`, so §11.8's coarse-pointer hit area has to be
                 * added by hand: a 16px target is unhittable on a touch
                 * screen. */
                className="-mr-0.5 relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11"
                onClick={onClearSelection}
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
            aria-activedescendant={picker.activeOptionId}
            aria-autocomplete="list"
            aria-controls={picker.isOpen ? picker.listboxId : undefined}
            aria-expanded={picker.isOpen}
            aria-label="Message Counselle"
            role="combobox"
            unstyled
            className={cn(
              "relative block w-full text-base leading-5 shadow-none outline-none [&_[data-slot=textarea]]:block [&_[data-slot=textarea]]:resize-none [&_[data-slot=textarea]]:overflow-y-auto [&_[data-slot=textarea]]:border-0 [&_[data-slot=textarea]]:bg-transparent [&_[data-slot=textarea]]:px-[var(--workspace-composer-inset)] [&_[data-slot=textarea]]:shadow-none [&_[data-slot=textarea]]:focus-visible:ring-0 [&_[data-slot=textarea]::placeholder]:text-[var(--workspace-composer-placeholder)]",
              "[&_[data-slot=textarea]]:text-[var(--workspace-composer-input-foreground)]",
              awaitingClarify
                ? "[&_[data-slot=textarea]]:min-h-13 [&_[data-slot=textarea]]:max-h-36 [&_[data-slot=textarea]]:pt-4 [&_[data-slot=textarea]]:pb-2"
                : "[&_[data-slot=textarea]]:min-h-18.5 [&_[data-slot=textarea]]:max-h-55 [&_[data-slot=textarea]]:pt-[var(--workspace-composer-prompt-inset-block-start)] [&_[data-slot=textarea]]:pb-3",
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

        <div
          className={cn(
            "mt-auto flex items-center justify-between bg-[var(--workspace-composer-surface)] px-[var(--workspace-composer-inset)]",
            awaitingClarify
              ? "gap-3 pb-3"
              : "flex-wrap gap-3 pb-[var(--workspace-composer-toolbar-inset-block-end)]",
          )}
        >
          {/* gap-2 matches AiComposer — see the note there on why 6px let the
              chips read as one segmented control. */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {awaitingClarify && (
              <p className="truncate text-[13px] leading-5 font-medium text-[var(--workspace-foreground-soft)]">
                {CLARIFY_HELPER}
              </p>
            )}
            {mode && modes.length > 0 && !awaitingClarify ? (
              <CounselingModeMenu
                canBrowseSkills={selectedSkills.length < maxTaskSkills}
                disabled={disabled || isSubmitting}
                mode={mode}
                modes={modes}
                onBrowseSkills={picker.insertTrigger}
                onModeChange={onModeChange}
              />
            ) : maxSelectedSkills > 0 && !awaitingClarify ? (
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
            {!awaitingClarify && (
              <>
                <SourcesMenu
                  disabled={disabled || isSubmitting}
                  onSourceConfigChange={onSourceConfigChange}
                  sourceConfig={sourceConfig}
                />
                {!hideResponseMode && (
                  <ResponseModeMenu
                    disabled={disabled || isSubmitting}
                    mode={responseMode}
                    modes={responseModes}
                    onModeChange={onResponseModeChange}
                  />
                )}
              </>
            )}
          </div>

          {isSubmitting ? (
            <Button
              aria-label="Stop"
              className={cn(
                composerSendButtonClass,
                awaitingClarify ? "size-8" : "size-9",
              )}
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
              className={cn(
                composerSendButtonClass,
                awaitingClarify ? "size-8" : "size-9",
              )}
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
