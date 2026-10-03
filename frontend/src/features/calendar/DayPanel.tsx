// The Day panel an aggregate opens (plan P6.3): every other school with a
// deadline that day, grouped by round, searchable, each addable to the list.
//
// Rows come from the raw all-schools items, not from the aggregate — the
// aggregate is already missing every listed school, so a school added here
// would vanish from under the pointer, and the aggregate itself can disappear
// once its group is empty. Schools added in this panel stay in place with an
// "On list" pill until the panel closes.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";

import type { CalendarRound, SchoolDeadlineItem } from "@/api/calendar/types";
import { InputPrimitive } from "@/components/ui/input";
import { DockedPanel } from "@/components/workspace/DockedPanel";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import { formatDayTitle } from "@/features/calendar/calendar-grid";
import {
  CALENDAR_ROUND_ORDER,
  calendarRoundLabel,
  pluralSchools,
} from "@/features/calendar/calendar-items";
import { formatCycle } from "@/features/calendar/calendar-labels";
import { canAddRound } from "@/features/calendar/useAddToList";
import type { DayPanelTarget } from "@/features/calendar/useCalendarState";
import { SchoolFavicon } from "@/features/schools/school-cells";
import { deadlineSourceLabel } from "@/features/schools/school-workspace-format";
import { parseDateOnly } from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

/** Case- and accent-insensitive: "Universite" finds "Université". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** The source line shared by the most schools due that day. */
function mostCommonSource(
  deadlines: SchoolDeadlineItem[],
  day: string,
): string | null {
  const counts = new Map<string, number>();
  for (const school of deadlines) {
    const source =
      school.date === day
        ? deadlineSourceLabel("facts", school.checked_at)
        : null;
    if (source) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [source, count] of counts) {
    if (!best || count > (counts.get(best) ?? 0)) {
      best = source;
    }
  }
  return best;
}

function SchoolRow({
  adding,
  commonSource,
  onAdd,
  onList,
  school,
}: {
  adding: boolean;
  /** The source line most rows share, said once in the header. */
  commonSource: string | null;
  onAdd: () => void;
  onList: boolean;
  school: SchoolDeadlineItem;
}) {
  const source = deadlineSourceLabel("facts", school.checked_at);
  const addable = canAddRound(school.round);
  return (
    <li className="group/row relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 transition-[background-color] duration-150 ease-out hover:bg-[var(--canvas-hover)] focus-within:bg-[var(--canvas-hover)] motion-reduce:transition-none">
      <SchoolFavicon size={16} websiteUrl={school.website_url} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-[var(--ink)]">
          {school.school_name}
        </span>
        {source !== commonSource ? (
          <span className="truncate text-xs text-[var(--ink-faint)]">
            {source}
          </span>
        ) : null}
      </div>
      {onList ? (
        <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[var(--calendar-onlist-surface)] pr-2.5 pl-2 text-xs font-medium text-[var(--calendar-onlist-ink)]">
          <Check
            aria-hidden="true"
            className="size-3.5 text-[var(--calendar-onlist-icon)]"
            strokeWidth={2.75}
          />
          On list
        </span>
      ) : addable ? (
        <button
          aria-label={`Add ${school.school_name} to list, ${calendarRoundLabel(school.round, "long")}`}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--edge-button)] bg-[var(--surface-raised)] text-[var(--ink-secondary)] outline-none",
            "transition-[opacity,background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
            "hover:border-[var(--edge-button-strong)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
            "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100",
            "disabled:cursor-wait disabled:opacity-64",
          )}
          disabled={adding}
          onClick={onAdd}
          type="button"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  );
}

function PanelBody({
  deadlines,
  listedUnitids,
  onAddToList,
  onClose,
  reportedPeriod,
  rounds,
  target,
}: {
  deadlines: SchoolDeadlineItem[];
  listedUnitids: ReadonlySet<number>;
  onAddToList: (school: SchoolDeadlineItem) => Promise<boolean>;
  onClose: () => void;
  reportedPeriod: string | undefined;
  rounds: readonly CalendarRound[];
  target: DayPanelTarget;
}) {
  const ctx = useCalendarContext();
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<ReadonlySet<number>>(() => new Set());
  const [adding, setAdding] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const needle = fold(query.trim());
    return CALENDAR_ROUND_ORDER.filter((round) => rounds.includes(round))
      .map((round) => ({
        round,
        schools: deadlines
          .filter(
            (school) =>
              school.date === target.day &&
              school.round === round &&
              (!listedUnitids.has(school.unitid) || added.has(school.unitid)) &&
              (!needle || fold(school.school_name).includes(needle)),
          )
          .sort((a, b) => a.school_name.localeCompare(b.school_name)),
      }))
      .filter((group) => group.schools.length > 0);
  }, [added, deadlines, listedUnitids, query, rounds, target.day]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-round="${target.round}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [target.round]);

  async function add(school: SchoolDeadlineItem) {
    setAdding(school.unitid);
    if (await onAddToList(school)) {
      setAdded((current) => new Set(current).add(school.unitid));
    }
    setAdding(null);
  }

  const total = groups.reduce((sum, group) => sum + group.schools.length, 0);
  const commonSource = useMemo(
    () => mostCommonSource(deadlines, target.day),
    [deadlines, target.day],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg leading-6 font-semibold tracking-tight text-[var(--ink)]">
            {formatDayTitle(parseDateOnly(target.day), ctx.today)}
          </h2>
          <p className="text-xs text-[var(--ink-faint)]">
            {pluralSchools(total)}
            {reportedPeriod ? ` · ${formatCycle(reportedPeriod)}` : ""}
            {commonSource ? (
              <span className="block">{commonSource}</span>
            ) : null}
          </p>
        </div>
        <button
          aria-label="Close"
          className="-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] outline-none transition-[background-color,color] duration-150 ease-out hover:bg-[var(--surface-inset)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <label className="relative flex items-center rounded-lg border border-[var(--edge-control)] bg-[var(--field-surface)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-2.5 size-4 text-[var(--ink-faint)]"
        />
        <InputPrimitive
          aria-label="Search schools"
          className="h-9 w-full min-w-0 bg-transparent ps-8 pe-3 text-sm outline-none placeholder:text-[var(--ink-placeholder)]"
          onValueChange={setQuery}
          placeholder="Search schools"
          type="search"
          value={query}
        />
      </label>
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto" ref={listRef}>
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-sm text-[var(--ink-secondary)]">
            {query.trim()
              ? `No schools match “${query.trim()}”`
              : "Every school with this deadline is on your list."}
          </p>
        ) : (
          groups.map((group) => (
            <section
              aria-label={calendarRoundLabel(group.round, "long")}
              className="not-first:mt-3"
              data-round={group.round}
              key={group.round}
            >
              <h3 className="sticky top-0 z-[var(--z-floating-panel)] flex items-baseline gap-2 bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-[var(--ink-faint)]">
                {calendarRoundLabel(group.round, "long")}
                <span className="tabular-nums">{group.schools.length}</span>
              </h3>
              <ul className="flex flex-col" role="list">
                {group.schools.map((school) => (
                  <SchoolRow
                    adding={adding === school.unitid}
                    commonSource={commonSource}
                    key={`${school.unitid}-${school.round}`}
                    onAdd={() => void add(school)}
                    onList={added.has(school.unitid)}
                    school={school}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export function DayPanel({
  deadlines,
  listedUnitids,
  onAddToList,
  onClose,
  reportedPeriod,
  rounds,
  target,
}: {
  deadlines: SchoolDeadlineItem[] | undefined;
  listedUnitids: ReadonlySet<number>;
  onAddToList: (school: SchoolDeadlineItem) => Promise<boolean>;
  onClose: () => void;
  reportedPeriod: string | undefined;
  rounds: readonly CalendarRound[];
  target: DayPanelTarget | null;
}) {
  const ctx = useCalendarContext();
  const title = target
    ? `Other schools due ${formatDayTitle(parseDateOnly(target.day), ctx.today)}`
    : "Other schools";
  return (
    <DockedPanel
      label={title}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={Boolean(target && deadlines)}
      title={title}
    >
      {target && deadlines ? (
        <PanelBody
          deadlines={deadlines}
          key={`${target.day}-${target.round}`}
          listedUnitids={listedUnitids}
          onAddToList={onAddToList}
          onClose={onClose}
          reportedPeriod={reportedPeriod}
          rounds={rounds}
          target={target}
        />
      ) : null}
    </DockedPanel>
  );
}
