import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";

import { useCreateTask } from "@/api/workspace/hooks";
import type { TaskCreate } from "@/api/workspace/types";
import { SchedulerPopover } from "@/features/tasks/SchedulerPopover";
import { schedulerOptions } from "@/features/tasks/task-config";
import type {
  IgnoredRanges,
  ParsedQuickAdd,
  QuickAddApplication,
  QuickAddContext,
  QuickAddEssay,
} from "@/features/tasks/task-parse";
import { getNowDate } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * design doc §5.1's context defaults, spec §4.2's last paragraph: quick-add on
 * an application page pre-sets `application_id`; on an essay page pre-sets
 * `essay_id`; Today defaults an undated task to today, Upcoming/Anytime leave
 * it null. The view passes exactly the defaults it owns — this component
 * never guesses which page it's on.
 */
export type QuickAddDefaults = {
  application_id?: string | null;
  essay_id?: string | null;
  requirement_kind?: string | null;
  when_on?: string | null;
};

export type QuickAddBarProps = {
  /** The cached lists `@school` / `#essay` fuzzy-match against (task-parse's `QuickAddContext`). */
  applications: QuickAddApplication[];
  essays: QuickAddEssay[];
  defaults?: QuickAddDefaults;
};

/** Auto-retry twice with backoff before giving up (design doc §5.4 / spec §4.4). */
const RETRY_BACKOFF_MS = [500, 1500] as const;

/** "on first focus of a session" (design doc §5.1) — persisted per tab so the
 * hint doesn't reappear on every remount as the student switches views. */
const HINT_DISMISSED_STORAGE_KEY = "counselle:tasks:quick-add-hint-dismissed";

/** design doc §5.3: the three resolved-date chips, in that order, reusing the
 * scheduler's own date math (task-config.ts) rather than a second copy of it. */
const WAITING_HINT_CHIP_IDS = new Set(["today", "tomorrow", "nextWeek"]);
const waitingHintChips = schedulerOptions.filter((option) =>
  WAITING_HINT_CHIP_IDS.has(option.id),
);

const WAITING_HINT_CHIP_CLASS = cn(
  "h-7 rounded-md px-2 text-chrome text-[var(--ink-secondary)] outline-none",
  "bg-[var(--control-quiet-surface)] transition-colors duration-150 ease-out motion-reduce:transition-none",
  "hover:bg-[var(--control-quiet-hover)] active:bg-[var(--control-quiet-active)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/**
 * The mirror layer's token spans (design doc §5.2). `px-0.5 -mx-0.5` is
 * always present, parsed or not, so the padding never enters or leaves the
 * mirror's box model — only `background-color` toggles, which is what keeps
 * the mirror in register with the input when a token is clicked off.
 */
function renderMirrorSegments(
  value: string,
  tokens: ParsedQuickAdd["tokens"],
  onUnparse: (substring: string) => void,
): ReactNode[] {
  if (tokens.length === 0) {
    return [value];
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      nodes.push(value.slice(cursor, token.start));
    }
    const text = value.slice(token.start, token.end);
    nodes.push(
      <span
        className={cn(
          "-mx-0.5 rounded-sm px-0.5",
          "pointer-events-auto cursor-pointer",
          "bg-[var(--task-parse-token-surface)] text-[var(--task-parse-token-ink)]",
          "transition-[background-color] duration-150 ease-out hover:bg-[var(--task-parse-token-hover)]",
        )}
        data-slot="quick-add-token"
        key={`${token.kind}-${token.start}-${token.end}`}
        onClick={() => onUnparse(text)}
        onMouseDown={(event) => event.preventDefault()}
        title="Keep as text"
      >
        {text}
      </span>,
    );
    cursor = token.end;
  }
  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }
  return nodes;
}

/**
 * design doc §5, spec §4. The quick-add bar: same shape as the row it
 * creates, invisible until focused, with inline parsed-token highlighting
 * over the grammar in `task-parse.ts`.
 *
 * The mirror technique (§5.2) is the one already in this codebase for the
 * composer's `@skill` highlight (`InlineSkillMentionLayer.tsx`,
 * `--workspace-composer-skill-highlight*` in `workspace.css`): an
 * `aria-hidden` layer painted over a color-transparent input. This component
 * adapts rather than copies it — the composer keeps its real textarea text
 * visible and uses a `box-shadow` trick to fake padding without disturbing
 * text-scroll sync, because its mirror only ever decorates. Here the design
 * doc calls for the opposite (real input text transparent, mirror text
 * visible, `caret-color` on the input) and for real padding cancelled by a
 * matching negative margin (`px-0.5 -mx-0.5`) rather than a box-shadow, since
 * that is what keeps a *toggleable* highlight from reflowing the mirror.
 */
export function QuickAddBar({
  applications,
  essays,
  defaults,
}: QuickAddBarProps) {
  const [value, setValue] = useState("");
  const [ignoredRanges, setIgnoredRanges] = useState<IgnoredRanges>(
    () => new Set(),
  );
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [parseQuickAddFn, setParseQuickAddFn] = useState<
    typeof import("@/features/tasks/task-parse").parseQuickAdd | null
  >(null);
  const [hintDismissed, setHintDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(HINT_DISMISSED_STORAGE_KEY) === "true",
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const loadingParserRef = useRef<Promise<void> | null>(null);

  const createTask = useCreateTask();
  const reduceMotion = useReducedMotion();

  const ctx = useMemo<QuickAddContext>(
    () => ({ applications, essays }),
    [applications, essays],
  );

  /** Lazy-loaded on first focus (plan §P5.5) so `chrono-node` stays out of
   * the initial `/app/tasks` chunk, matching `app/router.tsx`'s convention. */
  const ensureParserLoaded = useCallback(() => {
    if (parseQuickAddFn || loadingParserRef.current) {
      return loadingParserRef.current ?? Promise.resolve();
    }
    const promise = import("@/features/tasks/task-parse").then((module) => {
      setParseQuickAddFn(() => module.parseQuickAdd);
    });
    loadingParserRef.current = promise;
    return promise;
  }, [parseQuickAddFn]);

  const parsed = useMemo<ParsedQuickAdd>(() => {
    if (!parseQuickAddFn) {
      return { title: value, tokens: [], needsCheckIn: false };
    }
    return parseQuickAddFn(value, ctx, ignoredRanges, getNowDate());
  }, [value, ctx, ignoredRanges, parseQuickAddFn]);

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.key !== "n" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  function dismissHint() {
    if (hintDismissed) {
      return;
    }
    setHintDismissed(true);
    window.sessionStorage.setItem(HINT_DISMISSED_STORAGE_KEY, "true");
  }

  function buildPayload(
    title: string,
    whenOnOverride?: string | null,
  ): TaskCreate {
    const whenOn =
      whenOnOverride !== undefined
        ? (whenOnOverride ?? undefined)
        : (parsed.when_on ?? defaults?.when_on ?? undefined);
    return {
      title,
      when_on: whenOn,
      deadline_on: parsed.deadline_on,
      flagged: parsed.flagged,
      application_id: parsed.application_id ?? defaults?.application_id ?? undefined,
      essay_id: parsed.essay_id ?? defaults?.essay_id ?? undefined,
      requirement_kind: defaults?.requirement_kind ?? undefined,
    };
  }

  /**
   * design doc §5.4 / spec §4.4: the row is inserted immediately by
   * `useCreateTask`'s own optimistic `onMutate`; this only owns the
   * quick-add session's half — the input stays populated (never cleared)
   * until a create actually confirms, and retries automatically twice with
   * backoff before giving up.
   */
  async function attemptCreate(payload: TaskCreate) {
    setIsSubmitting(true);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await createTask.mutateAsync(payload);
        break;
      } catch {
        if (attempt >= RETRY_BACKOFF_MS.length) {
          break;
        }
        await wait(RETRY_BACKOFF_MS[attempt]);
      }
    }
    setIsSubmitting(false);
  }

  function handleCreateSettled() {
    setValue("");
    setIgnoredRanges(new Set());
    dismissHint();
    inputRef.current?.focus();
  }

  function submit(whenOnOverride?: string | null) {
    if (isSubmitting) {
      return;
    }
    const title = parsed.title.trim();
    if (!title) {
      return;
    }
    const payload = buildPayload(title, whenOnOverride);
    void attemptCreate(payload).then(() => {
      // Only clear/refocus on the path that actually resolved successfully;
      // a fully-exhausted retry leaves the input as the student typed it.
      if (!createTask.isError) {
        handleCreateSettled();
      }
    });
  }

  function handleFocus() {
    setIsFocused(true);
    void ensureParserLoaded();
  }

  function handleBlur() {
    setIsFocused(false);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
  }

  function handleScroll(event: UIEvent<HTMLInputElement>) {
    setScrollLeft(event.currentTarget.scrollLeft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.currentTarget.blur();
      setValue("");
      setIgnoredRanges(new Set());
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }

  function handleUnparse(substring: string) {
    setIgnoredRanges((previous) => new Set(previous).add(substring));
  }

  const showFirstFocusHint = isFocused && !hintDismissed;
  const showWaitingHint = isFocused && parsed.needsCheckIn;

  return (
    <div className="w-full" data-slot="quick-add-bar">
      <div
        className={cn(
          "group relative flex h-10 items-center gap-3 rounded-md border border-transparent pr-2 pl-2",
          "transition-colors duration-150 ease-out motion-reduce:transition-none",
          isFocused
            ? "border-[var(--edge-control)] bg-[var(--field-surface)] ring-[3px] ring-[var(--focus-ring)]"
            : "hover:bg-[var(--canvas-hover)]",
        )}
      >
        <Plus
          aria-hidden="true"
          className="pointer-events-none size-4 shrink-0 text-[var(--ink-faint)]"
        />
        <div className="relative min-w-0 flex-1">
          <input
            aria-label="Add a task"
            autoComplete="off"
            className="relative block w-full bg-transparent text-sm leading-5 outline-none placeholder:text-[var(--ink-placeholder)]"
            data-slot="quick-add-input"
            onBlur={handleBlur}
            onChange={handleChange}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            placeholder="Add a task…"
            ref={inputRef}
            style={{ color: "transparent", caretColor: "var(--ink)" }}
            type="text"
            value={value}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden text-sm leading-5 whitespace-pre text-[var(--ink)]"
            data-slot="quick-add-mirror"
          >
            <span
              className="inline-block"
              style={{ transform: `translateX(-${scrollLeft}px)` }}
            >
              {renderMirrorSegments(value, parsed.tokens, handleUnparse)}
            </span>
          </div>
        </div>
      </div>

      {showFirstFocusHint && (
        <p className="mt-1.5 pl-9 text-xs text-[var(--ink-faint)]">
          Try &quot;Berkeley CSS Profile fri&quot; — dates are picked up as
          you type.
        </p>
      )}

      <AnimatePresence>
        {showWaitingHint && (
          <motion.div
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            className="mt-1.5 flex flex-wrap items-center gap-2 pl-9"
            data-slot="quick-add-waiting-hint"
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            key="waiting-hint"
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <span className="text-xs text-[var(--ink-secondary)]">
              When should you check on this?
            </span>
            {waitingHintChips.map((option) => (
              <button
                className={WAITING_HINT_CHIP_CLASS}
                key={option.id}
                onClick={() => submit(option.resolveDate?.(getNowDate()))}
                type="button"
              >
                {option.label}
              </button>
            ))}
            <SchedulerPopover
              field="when_on"
              onChange={(nextValue) => submit(nextValue)}
              value={undefined}
            >
              <button className={WAITING_HINT_CHIP_CLASS} type="button">
                Pick a date
              </button>
            </SchedulerPopover>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
