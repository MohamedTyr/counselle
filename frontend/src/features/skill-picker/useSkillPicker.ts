import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

import type { SkillCatalogEntry } from "@/api/chat/types";
import {
  findSkillTrigger,
  insertSkillTrigger,
  normalizeInlineSkillSpacing,
  replaceSkillTrigger,
  rankSkills,
  type SkillTrigger,
} from "@/features/skill-picker/skill-query";

export type UseSkillPickerOptions = {
  text: string;
  onTextChange: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  catalog: readonly SkillCatalogEntry[];
  selectedSkills: readonly string[];
  onSelectedSkillsChange: (skills: string[]) => void;
  maxSelectedSkills: number;
  disabled?: boolean;
};

export type SkillPickerController = {
  activeIndex: number;
  activeOptionId: string | undefined;
  announcement: string | null;
  close: () => void;
  handleCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  handleCompositionStart: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleTextChange: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  handleTextareaSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  insertTrigger: () => void;
  isComposing: boolean;
  isOpen: boolean;
  listboxId: string;
  query: string;
  results: readonly SkillCatalogEntry[];
  selectSkill: (name: string) => void;
  setActiveIndex: (index: number) => void;
};

function focusTextareaAt(
  textarea: HTMLTextAreaElement | null,
  position: number,
) {
  queueMicrotask(() => {
    if (!textarea) {
      return;
    }

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(position, position);
  });
}

function optionId(listboxId: string, name: string) {
  return `${listboxId}-${name}`;
}

function hasSelectedSkillMention(
  text: string,
  name: string,
) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escapedName}(?=$|[^A-Za-z0-9-])`).test(text);
}

/**
 * Keeps mention parsing and selection state next to the composer textarea.
 * It intentionally does not own message submission: callers ask whether a
 * keyboard event was consumed before applying their existing send shortcut.
 */
export function useSkillPicker({
  text,
  onTextChange,
  textareaRef,
  catalog,
  selectedSkills,
  onSelectedSkillsChange,
  maxSelectedSkills,
  disabled = false,
}: UseSkillPickerOptions): SkillPickerController {
  const listboxId = useId();
  const [trigger, setTrigger] = useState<SkillTrigger | null>(null);
  const [activeSelection, setActiveSelection] = useState({
    index: 0,
    resultKey: "",
  });
  const [isComposing, setIsComposing] = useState(false);
  const [actionAnnouncement, setActionAnnouncement] = useState<string | null>(
    null,
  );
  const selectionRef = useRef({ start: text.length, end: text.length });

  const results = useMemo(
    () => (trigger ? rankSkills(catalog, trigger.query) : []),
    [catalog, trigger],
  );
  const isOpen = trigger !== null && !disabled && !isComposing;
  const resultKey = trigger
    ? `${trigger.start}:${trigger.end}:${trigger.query}:${catalog.map((skill) => skill.name).join("\u0000")}`
    : "";
  const requestedActiveIndex =
    activeSelection.resultKey === resultKey ? activeSelection.index : 0;
  const resolvedActiveIndex = Math.max(
    0,
    Math.min(requestedActiveIndex, results.length - 1),
  );
  const activeResult = results[resolvedActiveIndex];
  const availabilityAnnouncement = isOpen
    ? results.length === 0
      ? `No skills match ${trigger?.query ?? ""}.`
      : `${results.length} ${results.length === 1 ? "skill" : "skills"} available.`
    : null;

  const updateTrigger = useCallback(
    (nextText: string, start: number, end = start) => {
      selectionRef.current = { start, end };
      if (disabled || isComposing || start !== end) {
        setTrigger(null);
        return;
      }
      setTrigger(findSkillTrigger(nextText, start));
    },
    [disabled, isComposing],
  );

  useEffect(() => {
    const { start, end } = selectionRef.current;
    updateTrigger(text, start, end);
  }, [text, updateTrigger]);

  useEffect(() => {
    const nextSelectedSkills = selectedSkills.filter((name) =>
      hasSelectedSkillMention(text, name),
    );

    if (nextSelectedSkills.length !== selectedSkills.length) {
      onSelectedSkillsChange(nextSelectedSkills);
    }
  }, [onSelectedSkillsChange, selectedSkills, text]);

  const close = useCallback(() => {
    setTrigger(null);
  }, []);

  const setActiveIndex = useCallback(
    (index: number) => {
      setActiveSelection({ index, resultKey });
    },
    [resultKey],
  );

  const selectSkill = useCallback(
    (name: string) => {
      const selected = catalog.find((skill) => skill.name === name);
      if (!selected || !trigger || disabled || isComposing) {
        return;
      }

      if (selectedSkills.includes(name)) {
        setActionAnnouncement(`${selected.displayName} is already selected.`);
        return;
      }
      if (selectedSkills.length >= maxSelectedSkills) {
        setActionAnnouncement(
          `You can select up to ${maxSelectedSkills} skills.`,
        );
        return;
      }

      const replacement = replaceSkillTrigger(text, trigger, selected.name);
      onTextChange(replacement.text);
      onSelectedSkillsChange([...selectedSkills, name]);
      setActionAnnouncement(`${selected.displayName} added.`);
      setTrigger(null);
      selectionRef.current = {
        start: replacement.caret,
        end: replacement.caret,
      };
      focusTextareaAt(textareaRef.current, replacement.caret);
    },
    [
      catalog,
      disabled,
      isComposing,
      maxSelectedSkills,
      onSelectedSkillsChange,
      onTextChange,
      selectedSkills,
      text,
      textareaRef,
      trigger,
    ],
  );

  const handleTextChange = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const { selectionEnd, selectionStart, value } = event.currentTarget;
      setActionAnnouncement(null);
      const normalizedText = normalizeInlineSkillSpacing(value, selectedSkills);
      onTextChange(normalizedText);
      updateTrigger(
        normalizedText,
        selectionStart ?? normalizedText.length,
        selectionEnd ?? normalizedText.length,
      );
    },
    [onTextChange, selectedSkills, updateTrigger],
  );

  const handleTextareaSelect = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const { selectionEnd, selectionStart, value } = event.currentTarget;
      updateTrigger(
        value,
        selectionStart ?? value.length,
        selectionEnd ?? value.length,
      );
    },
    [updateTrigger],
  );

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
    setTrigger(null);
  }, []);

  const handleCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      setIsComposing(false);
      const { selectionEnd, selectionStart, value } = event.currentTarget;
      selectionRef.current = {
        start: selectionStart ?? value.length,
        end: selectionEnd ?? value.length,
      };
      // The subsequent input event carries the final controlled value. This
      // keeps composition text out of keyboard selection and send handling.
      onTextChange(value);
    },
    [onTextChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposing || event.nativeEvent.isComposing) {
        // Let the IME keep ownership of the keystroke, but tell the composer
        // not to interpret Enter as a send shortcut while composition is live.
        return event.key === "Enter";
      }
      if (!isOpen) {
        return false;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return true;
      }
      if (event.key === "Tab") {
        close();
        return false;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (activeResult) {
          selectSkill(activeResult.name);
        }
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (results.length === 0) {
          return false;
        }
        event.preventDefault();
        setActiveIndex(
          event.key === "ArrowDown"
            ? (resolvedActiveIndex + 1) % results.length
            : (resolvedActiveIndex - 1 + results.length) % results.length,
        );
        return true;
      }
      return false;
    },
    [
      activeResult,
      close,
      isComposing,
      isOpen,
      resolvedActiveIndex,
      results.length,
      selectSkill,
      setActiveIndex,
    ],
  );

  const insertTrigger = useCallback(() => {
    if (disabled || isComposing) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const start = textarea.selectionStart ?? text.length;
    const end = textarea.selectionEnd ?? start;
    const replacement = insertSkillTrigger(text, start, end);
    setActionAnnouncement(null);
    onTextChange(replacement.text);
    selectionRef.current = {
      start: replacement.caret,
      end: replacement.caret,
    };
    setTrigger({
      start: replacement.caret - 1,
      end: replacement.caret,
      query: "",
    });
    focusTextareaAt(textarea, replacement.caret);
  }, [disabled, isComposing, onTextChange, text, textareaRef]);

  return {
    activeIndex: resolvedActiveIndex,
    activeOptionId:
      isOpen && activeResult
        ? optionId(listboxId, activeResult.name)
        : undefined,
    announcement: actionAnnouncement ?? availabilityAnnouncement,
    close,
    handleCompositionEnd,
    handleCompositionStart,
    handleKeyDown,
    handleTextChange,
    handleTextareaSelect,
    insertTrigger,
    isComposing,
    isOpen,
    listboxId,
    query: trigger?.query ?? "",
    results,
    selectSkill,
    setActiveIndex,
  };
}
