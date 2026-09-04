import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Flag, X } from "lucide-react";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import { useScheduleTask, useUpdateTask } from "@/api/workspace/hooks";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Task } from "@/domain/task";
import { SchedulerPopover } from "@/features/tasks/SchedulerPopover";
import { formatRelativeTime, getNowDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export type TaskDetailPanelProps = {
  task: Task | undefined;
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/*
 * design doc §7.1 shell breakpoint. Distinct from `useIsMobile` (768px,
 * `hooks/use-mobile.ts`) — the detail panel switches at `lg` (1024px), not
 * `md`, so it gets its own small hook rather than repurposing that one.
 */
const DESKTOP_BREAKPOINT = 1024;

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= DESKTOP_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const onChange = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** design doc §7.1 — the aside's own exit duration; entry rides the default
 * 200ms transition below. Keeps the aside mounted for the exit so the
 * `translate`/`opacity` transition can play instead of the panel vanishing
 * mid-slide. */
const EXIT_MS = 150;

function useDelayedUnmount(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }

    const timeout = window.setTimeout(
      () => setMounted(false),
      prefersReducedMotion() ? 0 : EXIT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [open]);

  return mounted;
}

/**
 * `YYYY-MM-DD` → local-midnight `Date`. Never `new Date(dateKey)` — that
 * parses as UTC and can render the previous day in a negative-offset
 * timezone (plan §P5.1's correctness rule, repeated here because this file
 * formats dates independently of task-dates.ts's row-chip forms).
 */
function parseDateOnly(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** "Jan 1" (+ year, only when it differs from `referenceDate`'s). Used for
 * the deadline row, the deadline-inheritance display, and the footer's
 * created date — deliberately not task-dates.ts's chip formatters, which are
 * tuned for a 36px row (near-term words, weekday abbreviations) and don't
 * fit a panel that must show any date, however far out. */
function formatMonthDay(date: Date, referenceDate: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(
    date,
  );
  const day = date.getDate();
  const year =
    date.getFullYear() !== referenceDate.getFullYear()
      ? ` ${date.getFullYear()}`
      : "";
  return `${month} ${day}${year}`;
}

/** "Friday 5 September" (+ year when it differs) — the When row's own,
 * fuller date form (design doc §7.2's mockup), distinct from the deadline
 * row's "Jan 1" form. */
function formatWhenValue(whenOn: string, referenceDate: Date): string {
  const date = parseDateOnly(whenOn);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
    date,
  );
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    date,
  );
  const year =
    date.getFullYear() !== referenceDate.getFullYear()
      ? ` ${date.getFullYear()}`
      : "";
  return `${weekday} ${date.getDate()} ${month}${year}`;
}

/*
 * design doc §7.2 — "the editability signal, one rule for all five editable
 * regions" (title, notes, When, Deadline, Link): nothing at rest; a
 * `--surface-hover` fill on hover; a `--surface-inset` fill plus a 3px focus
 * ring on focus, no border, ever. The negative margin keeps the padding
 * always present so only the fill appears/disappears — the text itself
 * never moves. Textareas put focus on their inner `<textarea>`, not the
 * wrapper this class is applied to, hence the paired `has-[:focus-visible]`
 * variant alongside the plain one (which fires for the buttons, where the
 * button itself is the focused element).
 */
const editableRegionClass = cn(
  "-mx-2 -my-1 block w-full rounded-md px-2 py-1 text-left outline-none",
  "transition-[background-color] duration-150 ease-out",
  "hover:bg-[var(--surface-hover)]",
  "focus-visible:bg-[var(--surface-inset)] focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
  "has-[:focus-visible]:bg-[var(--surface-inset)] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--focus-ring)]",
);

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-20 shrink-0 text-xs text-[var(--ink-faint)]">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-[var(--ink)]">{children}</dd>
    </div>
  );
}

function TitleField({
  task,
  onCommit,
}: {
  task: Task;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(task.title);

  return (
    <Textarea
      aria-label="Task title"
      className={cn(
        editableRegionClass,
        "[&_[data-slot=textarea]]:min-h-0 [&_[data-slot=textarea]]:p-0 [&_[data-slot=textarea]]:text-lg [&_[data-slot=textarea]]:leading-snug [&_[data-slot=textarea]]:font-medium [&_[data-slot=textarea]]:text-[var(--ink)] [&_[data-slot=textarea]]:text-balance",
      )}
      onBlur={() => {
        const trimmed = draft.trim();
        // Title is never blank (spec §2.5) — reverting to the last saved
        // value on an empty blur, rather than sending it, is the client
        // half of that invariant.
        if (trimmed && trimmed !== task.title) {
          onCommit(trimmed);
        } else {
          setDraft(task.title);
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Escape") {
          event.currentTarget.blur();
        }
      }}
      unstyled
      value={draft}
    />
  );
}

function NotesField({
  task,
  onCommit,
}: {
  task: Task;
  onCommit: (notes: string | null) => void;
}) {
  const [draft, setDraft] = useState(task.notes ?? "");

  return (
    <Textarea
      aria-label="Task notes"
      className={cn(
        editableRegionClass,
        "[&_[data-slot=textarea]]:min-h-[4.5rem] [&_[data-slot=textarea]]:p-0 [&_[data-slot=textarea]]:text-sm [&_[data-slot=textarea]]:leading-relaxed [&_[data-slot=textarea]]:text-[var(--ink-secondary)]",
      )}
      onBlur={() => {
        const trimmed = draft.trim();
        const next = trimmed ? trimmed : null;
        if (next !== (task.notes ?? null)) {
          onCommit(next);
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      placeholder="Add notes"
      unstyled
      value={draft}
    />
  );
}

function LinkField({
  task,
  applications,
  essays,
  onLink,
}: {
  task: Task;
  applications: ApplicationView[];
  essays: EssaySummary[];
  onLink: (patch: { application_id: string | null; essay_id: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const application = task.application_id
    ? applications.find((item) => item.id === task.application_id)
    : undefined;
  const essay = task.essay_id
    ? essays.find((item) => item.id === task.essay_id)
    : undefined;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={`Change linked school or essay for "${task.title}"`}
        className={cn(editableRegionClass, "text-sm")}
      >
        {essay ? (
          <>
            <span className="text-[var(--ink)]">
              {application?.school_name ?? "Unknown school"}
            </span>
            <span className="text-[var(--ink-secondary)]"> · {essay.title} essay</span>
          </>
        ) : application ? (
          <span className="text-[var(--ink)]">{application.school_name}</span>
        ) : (
          <span className="text-[var(--ink-placeholder)]">Not linked</span>
        )}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search schools and essays…" />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            <CommandGroup heading="Schools">
              {applications.map((option) => (
                <CommandItem
                  key={option.id}
                  onSelect={() => {
                    onLink({ application_id: option.id, essay_id: task.essay_id ?? null });
                    setOpen(false);
                  }}
                  value={option.school_name}
                >
                  {option.school_name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Essays">
              {essays.map((option) => (
                <CommandItem
                  key={option.id}
                  onSelect={() => {
                    onLink({
                      application_id: option.application_id,
                      essay_id: option.id,
                    });
                    setOpen(false);
                  }}
                  value={option.title}
                >
                  {option.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverPopup>
    </Popover>
  );
}

function PanelBody({
  task,
  applicationsById,
  essaysById,
  onClose,
}: {
  task: Task;
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  onClose: () => void;
}) {
  const updateTask = useUpdateTask();
  const scheduleTask = useScheduleTask();
  const referenceDate = getNowDate();
  const linkedApplication = task.application_id
    ? applicationsById.get(task.application_id)
    : undefined;

  // spec §2.4 — deadline inheritance. Displayed only; never written to the
  // task. Setting an explicit deadline (via the scheduler) overrides it;
  // clearing that override returns here.
  const inheritedDeadline =
    !task.deadline_on && linkedApplication && linkedApplication.deadline
      ? linkedApplication.deadline
      : undefined;

  function commitTitle(title: string) {
    updateTask.mutate({ id: task.id, patch: { title } });
  }

  function commitNotes(notes: string | null) {
    updateTask.mutate({ id: task.id, patch: { notes } });
  }

  function toggleFlag() {
    updateTask.mutate({ id: task.id, patch: { flagged: !task.flagged } });
  }

  function scheduleWhen(value: string | null) {
    scheduleTask.mutate({ id: task.id, field: "when_on", value });
  }

  function scheduleDeadline(value: string | null) {
    scheduleTask.mutate({ id: task.id, field: "deadline_on", value });
  }

  function setLink(patch: { application_id: string | null; essay_id: string | null }) {
    updateTask.mutate({ id: task.id, patch });
  }

  const actorLabel = task.created_by_actor === "counselle" ? "Counselle" : "You";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 items-center justify-between">
        <button
          aria-label={task.flagged ? `Unflag "${task.title}"` : `Flag "${task.title}"`}
          aria-pressed={task.flagged}
          className={cn(
            "flex size-8 items-center justify-center rounded-md outline-none transition-[background-color] duration-150 ease-out",
            "hover:bg-[var(--surface-hover)]",
            "focus-visible:bg-[var(--surface-inset)] focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
          )}
          onClick={toggleFlag}
          type="button"
        >
          <Flag
            aria-hidden="true"
            className={cn(
              "size-4",
              task.flagged
                ? "fill-[var(--brand)] text-[var(--brand)]"
                : "text-[var(--ink-faint)]",
            )}
          />
        </button>
        <button
          aria-label="Close"
          className={cn(
            "flex size-8 items-center justify-center rounded-md outline-none transition-[background-color] duration-150 ease-out",
            "hover:bg-[var(--surface-hover)]",
            "focus-visible:bg-[var(--surface-inset)] focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
          )}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-4 text-[var(--ink-faint)]" />
        </button>
      </div>

      <div className="mt-4">
        <TitleField onCommit={commitTitle} task={task} />
      </div>

      <div className="mt-4">
        <NotesField onCommit={commitNotes} task={task} />
      </div>

      <div className="my-4 h-px bg-[var(--hairline)]" />

      <dl className="flex flex-col gap-3">
        <FieldRow label="When">
          <SchedulerPopover field="when_on" onChange={scheduleWhen} value={task.when_on}>
            <button
              aria-label={`Change when for "${task.title}"`}
              className={editableRegionClass}
              type="button"
            >
              {task.when_on ? (
                formatWhenValue(task.when_on, referenceDate)
              ) : (
                <span className="text-[var(--ink-placeholder)]">Anytime</span>
              )}
            </button>
          </SchedulerPopover>
        </FieldRow>

        <FieldRow label="Deadline">
          <SchedulerPopover
            field="deadline_on"
            onChange={scheduleDeadline}
            value={task.deadline_on}
          >
            <button
              aria-label={`Change deadline for "${task.title}"`}
              className={editableRegionClass}
              type="button"
            >
              {task.deadline_on ? (
                formatMonthDay(parseDateOnly(task.deadline_on), referenceDate)
              ) : inheritedDeadline ? (
                <>
                  <span className="text-[var(--ink-secondary)]">
                    {formatMonthDay(parseDateOnly(inheritedDeadline), referenceDate)}
                  </span>
                  <span className="text-xs text-[var(--ink-faint)]">
                    {" "}
                    · from {linkedApplication?.school_name}
                  </span>
                </>
              ) : (
                <span className="text-[var(--ink-placeholder)]">No deadline</span>
              )}
            </button>
          </SchedulerPopover>
        </FieldRow>

        <FieldRow label="Link">
          <LinkField
            applications={Array.from(applicationsById.values())}
            essays={Array.from(essaysById.values())}
            onLink={setLink}
            task={task}
          />
        </FieldRow>
      </dl>

      <div className="mt-auto border-t border-[var(--hairline)] pt-4">
        <p className="truncate text-xs text-[var(--ink-faint)]">
          Created {formatMonthDay(new Date(task.created_at), referenceDate)} by{" "}
          {actorLabel} · Updated {formatRelativeTime(task.updated_at)}
        </p>
      </div>
    </div>
  );
}

/**
 * design doc §7 — the task detail panel. `< lg` (1024px): a `Sheet` from the
 * bottom. `≥ lg`: a docked right `<aside>`, `w-[26rem]` (416px, the sources
 * rail's established docked-aside width — one docked-panel width in the
 * app, not two). Every one of the six rows plus the footer line, nothing
 * else (§7.2) — a future field has to displace one of these six to ship.
 */
export function TaskDetailPanel({
  task,
  applicationsById,
  essaysById,
  open,
  onOpenChange,
}: TaskDetailPanelProps) {
  const isDesktop = useIsDesktop();
  const mounted = useDelayedUnmount(open && Boolean(task));

  if (!task || !mounted) {
    return null;
  }

  if (!isDesktop) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetPopup
          className="max-h-[85dvh] rounded-t-2xl p-6"
          showCloseButton={false}
          side="bottom"
        >
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <PanelBody
            applicationsById={applicationsById}
            essaysById={essaysById}
            key={task.id}
            onClose={() => onOpenChange(false)}
            task={task}
          />
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <aside
      aria-label={`Task details for "${task.title}"`}
      className={cn(
        "fixed inset-y-0 end-0 z-[var(--z-sticky)] hidden w-[26rem] flex-col border-s border-[var(--edge)] bg-[var(--surface-raised)] p-6 lg:flex",
        "transition-[opacity,translate] ease-out motion-reduce:transition-[opacity]",
        open
          ? "translate-x-0 opacity-100 duration-200"
          : "translate-x-4 opacity-0 duration-150",
      )}
    >
      <PanelBody
        applicationsById={applicationsById}
        essaysById={essaysById}
        key={task.id}
        onClose={() => onOpenChange(false)}
        task={task}
      />
    </aside>
  );
}
