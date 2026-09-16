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

import {
  filterSlashCommands,
  findSlashTrigger,
  removeActiveSlashQuery,
  SLASH_COMMANDS,
  type ActiveSlashQuery,
  type SlashCommandEntry,
} from "@/features/slash-command/slash-query";

export type UseSlashCommandOptions = {
  text: string;
  onTextChange: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Defaults to `SLASH_COMMANDS` — the single v1 `/goal` entry. */
  catalog?: readonly SlashCommandEntry[];
  disabled?: boolean;
};

export type SlashCommandController = {
  activeIndex: number;
  activeOptionId: string | undefined;
  /**
   * The id of the command armed for the *next send* (e.g. `"goal"`), or
   * `null` when none is armed. This is set **only** by an explicit
   * selection (Enter or click) in `selectCommand` — never by the raw typed
   * text. Typing `/goal` and never selecting it from the menu must never
   * arm anything; that is a correctness requirement (§5.5), not a nicety,
   * because arming an autonomous, budget-spending run from unconfirmed
   * text would be dishonest.
   */
  armedCommandId: string | null;
  announcement: string | null;
  /**
   * Clears the armed command without touching composer text. The wiring
   * phase calls this after a successful send, and whenever the composer
   * text is cleared externally (also handled internally below whenever
   * `text` itself goes empty, so an orphaned chip can never survive a
   * cleared composer).
   */
  clearArmedCommand: () => void;
  close: () => void;
  handleCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  handleCompositionStart: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleTextChange: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  handleTextareaSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  isComposing: boolean;
  isOpen: boolean;
  listboxId: string;
  query: string;
  results: readonly SlashCommandEntry[];
  selectCommand: (id: string) => void;
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

function optionId(listboxId: string, id: string) {
  return `${listboxId}-${id}`;
}

/**
 * Keeps slash-trigger parsing and the armed-command chip state next to the
 * composer textarea. Mirrors only the trigger-detection half of
 * `useSkillPicker` (caret scanning, listbox navigation, first-refusal
 * `handleKeyDown`) — see `plans/goal-mode-plan.md` §5.5 for what
 * deliberately differs (removal instead of replacement, a state boolean
 * instead of a textual mention, no overlay).
 *
 * Like `useSkillPicker`, this hook does not own message submission: callers
 * check whether a keyboard event was consumed before applying their own send
 * shortcut, and are expected to chain this hook's `handleKeyDown` *before*
 * the skill picker's (slash → skill → submit, per §5.5 / `AiComposer.tsx`).
 */
export function useSlashCommand({
  text,
  onTextChange,
  textareaRef,
  catalog = SLASH_COMMANDS,
  disabled = false,
}: UseSlashCommandOptions): SlashCommandController {
  const listboxId = useId();
  const [trigger, setTrigger] = useState<ActiveSlashQuery | null>(null);
  const [activeSelection, setActiveSelection] = useState({
    index: 0,
    resultKey: "",
  });
  const [isComposing, setIsComposing] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [armedCommandId, setArmedCommandId] = useState<string | null>(null);
  const selectionRef = useRef({ start: text.length, end: text.length });
  // Selecting `/goal` when it is the composer's entire text arms the
  // command and empties the composer via `onTextChange`. The "empty
  // composer clears the chip" effect below must not fire for *that*
  // resulting empty value — only for a later, independent empty transition.
  // Keyed to the literal text the arming selection produced (rather than a
  // bare boolean flag) so this holds even if `onTextChange` lands on a later
  // render than the one that armed the command — a same-tick boolean would
  // get consumed by an unrelated render in between and silently fail to
  // protect the real transition.
  const pendingArmedClearTextRef = useRef<string | null>(null);

  const results = useMemo(
    () => (trigger ? filterSlashCommands(catalog, trigger.query) : []),
    [catalog, trigger],
  );
  const isOpen = trigger !== null && !disabled && !isComposing;
  const resultKey = trigger
    ? `${trigger.query}:${catalog.map((command) => command.id).join(",")}`
    : "";
  const requestedActiveIndex =
    activeSelection.resultKey === resultKey ? activeSelection.index : 0;
  const resolvedActiveIndex = Math.max(
    0,
    Math.min(requestedActiveIndex, results.length - 1),
  );
  const activeResult = results[resolvedActiveIndex];

  const updateTrigger = useCallback(
    (nextText: string, start: number, end = start) => {
      selectionRef.current = { start, end };
      if (disabled || isComposing || start !== end) {
        setTrigger(null);
        return;
      }
      setTrigger(findSlashTrigger(nextText, start));
    },
    [disabled, isComposing],
  );

  useEffect(() => {
    const { start, end } = selectionRef.current;
    updateTrigger(text, start, end);
  }, [text, updateTrigger]);

  // An empty composer can never carry an armed command — otherwise a chip
  // could survive independent of the text that armed it and silently apply
  // to an unrelated later message (§5.5).
  useEffect(() => {
    if (armedCommandId === null || text.trim().length !== 0) {
      return;
    }
    if (pendingArmedClearTextRef.current === text) {
      pendingArmedClearTextRef.current = null;
      return;
    }
    setArmedCommandId(null);
  }, [armedCommandId, text]);

  const close = useCallback(() => {
    setTrigger(null);
  }, []);

  const clearArmedCommand = useCallback(() => {
    setArmedCommandId(null);
  }, []);

  const setActiveIndex = useCallback(
    (index: number) => {
      setActiveSelection({ index, resultKey });
    },
    [resultKey],
  );

  const selectCommand = useCallback(
    (id: string) => {
      const command = catalog.find((entry) => entry.id === id);
      if (!command || !trigger || disabled || isComposing) {
        return;
      }

      const removal = removeActiveSlashQuery(text, trigger);
      pendingArmedClearTextRef.current =
        removal.text.trim().length === 0 ? removal.text : null;
      onTextChange(removal.text);
      setArmedCommandId(command.id);
      setAnnouncement(`${command.label} armed.`);
      setTrigger(null);
      selectionRef.current = {
        start: removal.selection.start,
        end: removal.selection.start,
      };
      focusTextareaAt(textareaRef.current, removal.selection.start);
    },
    [catalog, disabled, isComposing, onTextChange, text, textareaRef, trigger],
  );

  const handleTextChange = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const { selectionEnd, selectionStart, value } = event.currentTarget;
      setAnnouncement(null);
      updateTrigger(
        value,
        selectionStart ?? value.length,
        selectionEnd ?? value.length,
      );
    },
    [updateTrigger],
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
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposing || event.nativeEvent.isComposing) {
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
          selectCommand(activeResult.id);
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
      selectCommand,
      setActiveIndex,
    ],
  );

  return {
    activeIndex: resolvedActiveIndex,
    activeOptionId:
      isOpen && activeResult
        ? optionId(listboxId, activeResult.id)
        : undefined,
    armedCommandId,
    announcement,
    clearArmedCommand,
    close,
    handleCompositionEnd,
    handleCompositionStart,
    handleKeyDown,
    handleTextChange,
    handleTextareaSelect,
    isComposing,
    isOpen,
    listboxId,
    query: trigger?.query ?? "",
    results,
    selectCommand,
    setActiveIndex,
  };
}
