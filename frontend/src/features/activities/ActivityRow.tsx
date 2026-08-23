import { type DragEvent, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACTIVITY_LIMITS,
  commonAppCharacterCount,
  formatGrades,
  formatTiming,
  getActivityMissingFields,
  isActivityOverLimit,
  isActivityReady,
  type Activity,
} from "@/domain/activity";
import { cn } from "@/lib/utils";
import {
  CharCounter,
  RankBadge,
} from "@/features/activities/activity-indicators";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clock3,
  GraduationCap,
  GripVertical,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";

function ActivityMetaLine({ activity }: { activity: Activity }) {
  const parts: ReactNode[] = [
    <span className="inline-flex items-center gap-1" key="grades">
      <GraduationCap aria-hidden="true" className="size-3.5 opacity-70" />
      {formatGrades(activity.grades)}
    </span>,
    <span className="inline-flex items-center gap-1" key="timing">
      <CalendarDays aria-hidden="true" className="size-3.5 opacity-70" />
      {formatTiming(activity.timing)}
    </span>,
  ];

  if (activity.hours_per_week !== undefined) {
    parts.push(
      <span className="inline-flex items-center gap-1" key="hours">
        <Clock3 aria-hidden="true" className="size-3.5 opacity-70" />
        {activity.hours_per_week} hr/wk
      </span>,
    );
  }

  if (activity.weeks_per_year !== undefined) {
    parts.push(
      <span className="tabular-nums" key="weeks">
        {activity.weeks_per_year} wk/yr
      </span>,
    );
  }

  if (activity.continue_in_college) {
    parts.push(
      <span
        className="inline-flex items-center gap-1 text-[var(--ink-secondary)]"
        key="college"
      >
        <GraduationCap aria-hidden="true" className="size-3.5" />
        College
      </span>,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-[var(--ink-muted)] tabular-nums">
      {parts.map((part, index) => (
        <span className="inline-flex items-center gap-x-1.5" key={index}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-[var(--ink-faint)]">
              ·
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </div>
  );
}

function ActivityRowMenu({
  activity,
  index,
  onDelete,
  onMove,
  total,
}: {
  activity: Activity;
  index: number;
  onDelete: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  total: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${activity.position || "activity"}`}
        className={cn(
          buttonVariants({ size: "icon-sm", variant: "ghost" }),
          "size-7 text-muted-foreground opacity-0 shadow-[var(--elevation-0)] transition-[opacity,background-color,box-shadow] group-hover/activity:bg-[color:var(--activity-control-surface)] group-hover/activity:opacity-100 group-hover/activity:shadow-[var(--elevation-1)] focus-visible:bg-[color:var(--activity-control-surface)] focus-visible:opacity-100 data-[state=open]:bg-[color:var(--activity-control-surface)] data-[state=open]:opacity-100 pointer-coarse:opacity-100",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-40"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp aria-hidden="true" />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown aria-hidden="true" />
          Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(activity.id)}
          variant="destructive"
        >
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ActivityRowProps = {
  activity: Activity;
  index: number;
  isDragging: boolean;
  layout: false | "position";
  onArmDrag: () => void;
  onDelete: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, targetId: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onOpen: (id: string) => void;
  total: number;
};

export function ActivityRow({
  activity,
  index,
  isDragging,
  layout,
  onArmDrag,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onMove,
  onOpen,
  total,
}: ActivityRowProps) {
  const missingFields = getActivityMissingFields(activity);
  const ready = isActivityReady(activity);
  const descriptionMissing = !activity.description.trim();
  const nonDescriptionMissing = missingFields.filter(
    (field) => field !== "Description",
  );

  return (
    <motion.div
      className="border-b border-[var(--hairline)] p-1 last:border-b-0"
      exit={layout ? { opacity: 0, scale: 0.98 } : undefined}
      layout={layout}
      transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.7 }}
    >
      <article
        className={cn(
          "group/activity relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-xl border border-transparent bg-[color:var(--activity-row-surface)] px-4 py-3.5 shadow-[var(--activity-row-shadow)] transition-[background-color,border-color,box-shadow] outline-none hover:border-[color:var(--activity-row-border)] hover:bg-[color:var(--activity-row-hover)] focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)]",
          isDragging && "opacity-55",
        )}
        data-activity-id={activity.id}
        draggable
        onClick={() => onOpen(activity.id)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(event, activity.id)}
        onDragStart={(event) => onDragStart(event, activity.id)}
        onDrop={onDrop}
      >
        <button
          aria-label={`Activity ${activity.order}: ${activity.position || "Untitled"}`}
          className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)]"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(activity.id);
          }}
          type="button"
        />
        <div className="flex items-start gap-1.5 pt-0.5">
          <RankBadge isReady={ready} order={activity.order} />
          <button
            aria-label={`Reorder ${activity.position || "activity"}`}
            className="mt-0.5 flex size-6 cursor-grab items-center justify-center rounded-md text-[var(--ink-faint)] opacity-0 transition-[color,opacity,background-color] group-hover/activity:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:outline-none active:cursor-grabbing pointer-coarse:opacity-100"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={onArmDrag}
            type="button"
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="min-w-0">
          <div className="min-w-0 pr-[min(19rem,45%)]">
            <h3 className="min-w-0 text-sm leading-5 font-semibold text-balance text-wrap text-foreground">
              {activity.position || (
                <span className="text-muted-foreground italic">
                  Untitled activity
                </span>
              )}
            </h3>

            <p className="mt-1 text-xs leading-4 text-wrap text-[var(--ink-muted)]">
              {activity.organization || "No organization"}
            </p>
          </div>

          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4">
            {descriptionMissing ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs leading-5 text-[color:var(--activity-warning-fg)]">
                <AlertTriangle
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                />
                Description missing
              </span>
            ) : (
              <p
                className={cn(
                  "max-w-[78ch] min-w-0 text-[13px] leading-5 text-wrap",
                  isActivityOverLimit(activity)
                    ? "text-foreground"
                    : "text-[var(--ink-secondary)]",
                )}
              >
                {activity.description}
              </p>
            )}
            <div className="justify-self-start sm:justify-self-end">
              <CharCounter
                hideOverIcon
                length={commonAppCharacterCount(activity.description)}
                limit={ACTIVITY_LIMITS.description}
              />
            </div>
          </div>

          <div className="mt-1.5">
            <ActivityMetaLine activity={activity} />
          </div>
        </div>
        <div className="absolute top-4 right-4 flex max-w-[min(19rem,42%)] items-center justify-end gap-2.5">
          {!ready && !descriptionMissing ? (
            <AlertTriangle
              aria-label={`Not paste-ready: ${nonDescriptionMissing.join(", ") || "over limit"}`}
              className="size-4 shrink-0 text-[color:var(--activity-warning-fg)] transition-opacity group-hover/activity:opacity-0 group-has-[button[data-state=open]]/activity:opacity-0"
            />
          ) : null}
          <Badge
            className="h-6 max-w-full min-w-0 overflow-hidden border-[color:var(--activity-chip-border)] bg-[color:var(--activity-chip-surface)] px-2 py-0 text-right font-normal text-ellipsis whitespace-nowrap text-[var(--ink-muted)] transition-opacity group-hover/activity:opacity-0 group-has-[button[data-state=open]]/activity:opacity-0"
            variant="outline"
            title={activity.type}
          >
            {activity.type}
          </Badge>
          <div className="absolute top-0 right-0">
            <ActivityRowMenu
              activity={activity}
              index={index}
              onDelete={onDelete}
              onMove={onMove}
              total={total}
            />
          </div>
        </div>
      </article>
    </motion.div>
  );
}
