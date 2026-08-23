import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTIVITY_LIMITS,
  commonAppCharacterCount,
  HOURS_MAX,
  WEEKS_MAX,
  activityTypeOptions,
  gradeOptions,
  sortGrades,
  timingOptions,
  type Activity,
  type ActivityType,
  type Grade,
  type Timing,
} from "@/domain/activity";
import { cn } from "@/lib/utils";
import { drawerControlClassName } from "@/features/activities/activities-config";
import { formatReadableDate } from "@/features/activities/activities-format";
import {
  CharCounter,
  CharLimitAnnouncer,
} from "@/features/activities/activity-indicators";
import {
  CheckChipGroup,
  CopyFieldButton,
  DrawerField,
  DrawerSectionLabel,
  NumberField,
} from "@/features/activities/activity-form-controls";
import { ArrowDown, ArrowUp, Lock, Trash2 } from "lucide-react";

export function ActivityDrawer({
  activity,
  onDelete,
  onMove,
  onOpenChange,
  onUpdate,
  open,
  position,
  total,
}: {
  activity?: Activity;
  onDelete: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, patch: Partial<Activity>) => void;
  open: boolean;
  position: number;
  total: number;
}) {
  const positionId = useId();
  const organizationId = useId();
  const descriptionId = useId();
  const descriptionCounterId = useId();
  const storyId = useId();

  if (!activity) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetPopup
          className="max-sm:w-full max-sm:max-w-none max-sm:border-s-0 sm:max-w-[30rem]"
          side="right"
          variant="inset"
        />
      </Sheet>
    );
  }

  const current = activity;

  function update(patch: Partial<Activity>) {
    onUpdate(current.id, patch);
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup
        className="max-sm:w-full max-sm:max-w-none max-sm:border-s-0 sm:max-w-[30rem]"
        side="right"
        variant="inset"
      >
        <SheetHeader className="pr-14">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Edit activity</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              #{position} of {total}
            </span>
          </div>
          <SheetTitle className="text-lg">
            {current.position || "Untitled activity"}
          </SheetTitle>
        </SheetHeader>

        <SheetPanel className="flex flex-col gap-6">
          <section className="grid gap-4">
            <DrawerField label="Type">
              <Select
                items={activityTypeOptions}
                onValueChange={(value) =>
                  update({ type: value as ActivityType })
                }
                value={current.type}
              >
                <SelectTrigger
                  aria-label="Activity type"
                  className={cn("w-full", drawerControlClassName)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup align="start" className="max-h-72 min-w-[16rem]">
                  <SelectGroup>
                    {activityTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectPopup>
              </Select>
            </DrawerField>

            <DrawerField
              label="Position"
              labelFor={positionId}
              trailing={
                <>
                  <CharCounter
                    length={commonAppCharacterCount(current.position)}
                    limit={ACTIVITY_LIMITS.position}
                  />
                  <CopyFieldButton
                    label="Copy position"
                    value={current.position}
                  />
                </>
              }
            >
              <Input
                className={drawerControlClassName}
                id={positionId}
                onChange={(event) => update({ position: event.target.value })}
                placeholder="e.g. Founder & President"
                value={current.position}
              />
              <CharLimitAnnouncer
                length={commonAppCharacterCount(current.position)}
                limit={ACTIVITY_LIMITS.position}
              />
            </DrawerField>

            <DrawerField
              label="Organization"
              labelFor={organizationId}
              trailing={
                <>
                  <CharCounter
                    length={commonAppCharacterCount(current.organization)}
                    limit={ACTIVITY_LIMITS.organization}
                  />
                  <CopyFieldButton
                    label="Copy organization"
                    value={current.organization}
                  />
                </>
              }
            >
              <Input
                className={drawerControlClassName}
                id={organizationId}
                onChange={(event) =>
                  update({ organization: event.target.value })
                }
                placeholder="e.g. Robotics Club, Al-Noor High School"
                value={current.organization}
              />
              <CharLimitAnnouncer
                length={commonAppCharacterCount(current.organization)}
                limit={ACTIVITY_LIMITS.organization}
              />
            </DrawerField>

            <DrawerField
              label="Description"
              labelFor={descriptionId}
              trailing={
                <>
                  <CharCounter
                    id={descriptionCounterId}
                    length={commonAppCharacterCount(current.description)}
                    limit={ACTIVITY_LIMITS.description}
                  />
                  <CopyFieldButton
                    label="Copy description"
                    value={current.description}
                  />
                </>
              }
            >
              <Textarea
                aria-describedby={descriptionCounterId}
                className={cn(
                  "[&_[data-slot=textarea]]:min-h-20 [&_[data-slot=textarea]]:resize-none",
                  drawerControlClassName,
                )}
                id={descriptionId}
                onChange={(event) =>
                  update({ description: event.target.value })
                }
                placeholder="What you did and its impact, compressed to 150 characters."
                value={current.description}
              />
              <CharLimitAnnouncer
                length={commonAppCharacterCount(current.description)}
                limit={ACTIVITY_LIMITS.description}
              />
            </DrawerField>

            <DrawerField label="Grades">
              <CheckChipGroup<Grade>
                ariaLabel="Participation grade levels"
                onChange={(grades) => update({ grades: sortGrades(grades) })}
                options={gradeOptions}
                value={current.grades}
              />
            </DrawerField>

            <DrawerField label="Timing">
              <CheckChipGroup<Timing>
                ariaLabel="When you participated"
                onChange={(timing) => update({ timing })}
                options={timingOptions}
                value={current.timing}
              />
            </DrawerField>

            <div className="grid grid-cols-2 gap-4">
              <DrawerField label="Hours / week">
                <NumberField
                  ariaLabel="Hours per week"
                  max={HOURS_MAX}
                  onChange={(hours_per_week) => update({ hours_per_week })}
                  placeholder="12"
                  value={current.hours_per_week}
                />
              </DrawerField>
              <DrawerField label="Weeks / year">
                <NumberField
                  ariaLabel="Weeks per year"
                  max={WEEKS_MAX}
                  onChange={(weeks_per_year) => update({ weeks_per_year })}
                  placeholder="30"
                  value={current.weeks_per_year}
                />
              </DrawerField>
            </div>

            <label
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors",
                drawerControlClassName,
              )}
            >
              <input
                checked={current.continue_in_college ?? false}
                className="size-4 accent-foreground"
                onChange={(event) =>
                  update({ continue_in_college: event.target.checked })
                }
                type="checkbox"
              />
              I intend to continue this in college
            </label>
          </section>

          <section className="grid gap-2">
            <div className="flex items-center gap-2">
              <Lock
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
              <DrawerSectionLabel>The full story</DrawerSectionLabel>
            </div>
            <p className="text-xs text-muted-foreground">
              Notes for yourself. This does not get copied into applications.
            </p>
            <Textarea
              className={cn(
                "mt-1 [&_[data-slot=textarea]]:min-h-28 [&_[data-slot=textarea]]:resize-none",
                drawerControlClassName,
              )}
              id={storyId}
              onChange={(event) =>
                update({ story: event.target.value || undefined })
              }
              placeholder="What actually happened, the numbers, the impact, the anecdotes…"
              value={current.story ?? ""}
            />
          </section>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1">
              <Button
                aria-label="Move up"
                disabled={position === 1}
                onClick={() => onMove(position - 1, -1)}
                size="sm"
                type="button"
                variant="outline"
              >
                <ArrowUp aria-hidden="true" data-icon="inline-start" />
                Up
              </Button>
              <Button
                aria-label="Move down"
                disabled={position === total}
                onClick={() => onMove(position - 1, 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                <ArrowDown aria-hidden="true" data-icon="inline-start" />
                Down
              </Button>
            </div>
            <Button
              onClick={() => onDelete(current.id)}
              size="sm"
              type="button"
              variant="destructive-outline"
            >
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              Delete
            </Button>
          </div>

          <p className="text-xs text-[var(--ink-muted)] tabular-nums">
            Created {formatReadableDate(current.created_at)} · Updated{" "}
            {formatReadableDate(current.updated_at)}
          </p>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
