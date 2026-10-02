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
  MissingFields,
} from "@/features/activities/activity-indicators";
import {
  RankedRow,
  rankedRowTrailingClass,
  type RankedRowHandlers,
} from "@/features/activities/RankedRow";

function metaParts(activity: Activity): string[] {
  const parts = [formatGrades(activity.grades), formatTiming(activity.timing)];

  if (activity.hours_per_week !== undefined) {
    parts.push(`${activity.hours_per_week} hr/wk`);
  }

  if (activity.weeks_per_year !== undefined) {
    parts.push(`${activity.weeks_per_year} wk/yr`);
  }

  if (activity.continue_in_college) {
    parts.push("Continuing in college");
  }

  return parts;
}

function ActivityMetaLine({ activity }: { activity: Activity }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-[var(--ink-muted)] tabular-nums">
      {metaParts(activity).map((part, index, parts) => (
        // The separator trails its part, so a wrapped line ends on a dot
        // instead of starting with one.
        <span className="inline-flex items-center gap-x-1.5" key={index}>
          <span>{part}</span>
          {index < parts.length - 1 ? (
            <span aria-hidden="true" className="text-[var(--ink-faint)]">
              ·
            </span>
          ) : null}
        </span>
      ))}
    </p>
  );
}

export function ActivityRow({
  activity,
  ...handlers
}: RankedRowHandlers & { activity: Activity }) {
  const ready = isActivityReady(activity);
  const descriptionLength = commonAppCharacterCount(activity.description);

  return (
    <RankedRow
      {...handlers}
      id={activity.id}
      idAttribute="data-activity-id"
      name={activity.position || "activity"}
      openLabel={`Activity ${activity.order}: ${activity.position || "Untitled"}`}
      order={activity.order}
      ready={ready}
    >
      <div className="flex items-start justify-between gap-[var(--activity-trailing-gap)]">
        <div className="flex min-h-[var(--activity-rank-size)] min-w-0 flex-col justify-center">
          <h3 className="text-sm leading-5 font-semibold text-wrap text-[var(--ink)]">
            {activity.position || (
              <span className="font-medium text-[var(--ink-faint)] italic">
                Untitled activity
              </span>
            )}
          </h3>
          {activity.organization ? (
            <p className="text-[13px] leading-5 text-wrap text-[var(--ink-secondary)]">
              {activity.organization}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            rankedRowTrailingClass,
            "mt-0.5 hidden h-6 max-w-44 shrink-0 truncate rounded-full bg-[var(--control-quiet-surface)] px-2.5 text-xs leading-6 text-[var(--ink-secondary)] sm:inline-block",
          )}
          title={activity.type}
        >
          {activity.type}
        </span>
      </div>

      {activity.description.trim() ? (
        <p
          className={cn(
            "mt-2 max-w-[72ch] text-[13px] leading-5 text-pretty",
            isActivityOverLimit(activity)
              ? "text-[var(--ink)]"
              : "text-[var(--ink-secondary)]",
          )}
        >
          {activity.description}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <ActivityMetaLine activity={activity} />
        <CharCounter
          hideOverIcon
          length={descriptionLength}
          limit={ACTIVITY_LIMITS.description}
          meter
        />
      </div>

      {!ready ? (
        <div className="mt-1.5">
          <MissingFields fields={getActivityMissingFields(activity)} />
        </div>
      ) : null}
    </RankedRow>
  );
}
