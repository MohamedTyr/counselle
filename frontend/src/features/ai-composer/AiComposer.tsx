import { Square } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import attachIcon from "@/assets/app-shell/attach.svg";
import imageIcon from "@/assets/app-shell/image.svg";
import sendIcon from "@/assets/app-shell/send.svg";
import { Textarea } from "@/components/ui/textarea";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
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
  GoalModeToggle,
  RunSettings,
  SkillTrigger,
} from "@/features/ai-composer/RunSettings";
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
    minHeight: 87,
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
  // Goal mode is on when the toggle is on or `/goal` was picked from the
  // slash menu; both are explicit choices, never inferred from typed text.
  const [goalToggled, setGoalToggled] = useState(false);
  const goalArmed = goalToggled || slash.armedCommandId === "goal";
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
    setGoalToggled(false);
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
      <div className="as-composer" ref={composerRef}>
        <div className="as-composer-input relative">
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
            placeholder="Ask anything about colleges or your application"
            ref={textareaRef}
            style={{ resize: "none" }}
            value={value}
          />
        </div>

        <div className="as-toolbar">
          <GoalModeToggle
            disabled={disabled || isSubmitting}
            on={goalArmed}
            onToggle={() => {
              if (goalArmed) {
                setGoalToggled(false);
                slash.clearArmedCommand();
              } else {
                setGoalToggled(true);
              }
            }}
          />
          <RunSettings
            disabled={disabled || isSubmitting}
            modeSettings={
              mode && modes.length > 0 ? { mode, modes, onModeChange } : null
            }
            skills={{
              canBrowse: selectedSkills.length < maxTaskSkills,
              onBrowse: picker.insertTrigger,
            }}
            sources={{ sourceConfig, onSourceConfigChange }}
            speed={
              { mode: responseMode, modes: responseModes, onModeChange: onResponseModeChange }
            }
          />
          {(!mode || modes.length === 0) && maxSelectedSkills > 0 && (
            <SkillTrigger
              disabled={disabled || isSubmitting}
              onClick={picker.insertTrigger}
            />
          )}
          <span aria-hidden="true" className="as-toolbar-spacer" />
          <button aria-label="Attach a file" className="as-tool" disabled type="button">
            <img alt="" height={18} src={attachIcon} width={18} />
          </button>
          <button aria-label="Add an image" className="as-tool" disabled type="button">
            <img alt="" height={18} src={imageIcon} width={18} />
          </button>
          {canCancel ? (
            <button
              aria-label="Stop response"
              className="as-send"
              onClick={onCancel}
              type="button"
            >
              <Square aria-hidden="true" className="size-3 fill-current" />
            </button>
          ) : (
            <button
              aria-label="Send message"
              className="as-send"
              disabled={!canSubmit}
              type="submit"
            >
              <img alt="" height={15} src={sendIcon} width={15} />
            </button>
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
