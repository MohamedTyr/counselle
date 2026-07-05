import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  HONOR_TITLE_LIMIT,
  gradeOptions,
  levelOptions,
  sortGrades,
  sortLevels,
  type Grade,
  type Honor,
  type RecognitionLevel,
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
} from "@/features/activities/activity-form-controls";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

export function HonorDrawer({
  honor,
  onDelete,
  onMove,
  onOpenChange,
  onUpdate,
  open,
  position,
  total,
}: {
  honor?: Honor;
  onDelete: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, patch: Partial<Honor>) => void;
  open: boolean;
  position: number;
  total: number;
}) {
  const titleId = useId();

  if (!honor) {
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

  const current = honor;

  function update(patch: Partial<Honor>) {
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
            <span>Edit honor</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              #{position} of {total}
            </span>
          </div>
          <SheetTitle className="text-lg">
            {current.title || "Untitled honor"}
          </SheetTitle>
        </SheetHeader>

        <SheetPanel className="flex flex-col gap-6">
          <section className="grid gap-4">
            <DrawerSectionLabel>Academic honor</DrawerSectionLabel>

            <DrawerField
              label="Title"
              labelFor={titleId}
              trailing={
                <>
                  <CharCounter
                    length={current.title.length}
                    limit={HONOR_TITLE_LIMIT}
                  />
                  <CopyFieldButton label="Copy title" value={current.title} />
                </>
              }
            >
              <Textarea
                className={cn(
                  "[&_[data-slot=textarea]]:min-h-16 [&_[data-slot=textarea]]:resize-none",
                  drawerControlClassName,
                )}
                id={titleId}
                onChange={(event) => update({ title: event.target.value })}
                placeholder="e.g. National Physics Olympiad - Silver Medal"
                value={current.title}
              />
              <CharLimitAnnouncer
                length={current.title.length}
                limit={HONOR_TITLE_LIMIT}
              />
            </DrawerField>

            <DrawerField label="Grades">
              <CheckChipGroup<Grade>
                ariaLabel="Grade levels for this honor"
                onChange={(grades) => update({ grades: sortGrades(grades) })}
                options={gradeOptions}
                value={current.grades}
              />
            </DrawerField>

            <DrawerField label="Level(s) of recognition">
              <CheckChipGroup<RecognitionLevel>
                ariaLabel="Levels of recognition"
                onChange={(levels) => update({ levels: sortLevels(levels) })}
                options={levelOptions}
                value={current.levels}
              />
            </DrawerField>
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
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

          <p className="text-xs text-muted-foreground/80 tabular-nums">
            Created {formatReadableDate(current.created_at)} · Updated{" "}
            {formatReadableDate(current.updated_at)}
          </p>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
