import {
  commonAppCharacterCount,
  formatGrades,
  HONOR_TITLE_LIMIT,
  formatLevels,
  getHonorMissingFields,
  isHonorOverLimit,
  isHonorReady,
  type Honor,
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

export function HonorRow({
  honor,
  ...handlers
}: RankedRowHandlers & { honor: Honor }) {
  const ready = isHonorReady(honor);

  return (
    <RankedRow
      {...handlers}
      id={honor.id}
      idAttribute="data-honor-id"
      name={honor.title || "honor"}
      openLabel={`Honor ${honor.order}: ${honor.title || "Untitled"}`}
      order={honor.order}
      ready={ready}
    >
      <div className="flex min-h-[var(--activity-rank-size)] flex-col justify-center gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-[var(--activity-trailing-gap)]">
        <h3 className="text-sm leading-5 font-medium text-wrap text-[var(--ink)]">
          {honor.title || (
            <span className="text-[var(--ink-faint)] italic">
              Untitled honor
            </span>
          )}
        </h3>
        <p
          className={cn(
            rankedRowTrailingClass,
            "flex shrink-0 flex-wrap items-center gap-x-1.5 text-xs text-[var(--ink-muted)] tabular-nums",
          )}
        >
          <span>{formatLevels(honor.levels)}</span>
          <span aria-hidden="true" className="text-[var(--ink-faint)]">
            ·
          </span>
          <span className="whitespace-nowrap">
            {formatGrades(honor.grades)}
          </span>
        </p>
      </div>
      {!ready ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <MissingFields fields={getHonorMissingFields(honor)} />
          {isHonorOverLimit(honor) ? (
            <CharCounter
              hideOverIcon
              length={commonAppCharacterCount(honor.title)}
              limit={HONOR_TITLE_LIMIT}
              meter
            />
          ) : null}
        </div>
      ) : null}
    </RankedRow>
  );
}
