import { useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";

import {
  useActivities,
  useArchiveActivity,
  useArchiveHonor,
  useCreateActivity,
  useCreateHonor,
  useHonors,
  useReorderActivities,
  useReorderHonors,
  useRestoreActivity,
  useRestoreHonor,
  useUpdateActivity,
  useUpdateHonor,
} from "@/api/workspace/hooks";
import type {
  Activity as ApiActivity,
  ActivityPatch,
  Honor as ApiHonor,
  HonorPatch,
} from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { UndoToast } from "@/components/undo-toast";
import { PageContainer } from "@/components/workspace/PageContainer";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  MAX_ACTIVITIES,
  MAX_HONORS,
  type Activity,
  type ActivityType,
  type Grade,
  type Honor,
  type RecognitionLevel,
  type Timing,
  activityTypeOptions,
  gradeOptions,
  levelOptions,
  timingOptions,
} from "@/domain/activity";
import {
  getActivitySlots,
  getHonorSlots,
} from "@/features/activities/activities-mutations";
import {
  renumber,
  reorderById,
  swapByIndex,
} from "@/features/activities/activities-reorder";
import { ActivityDrawer } from "@/features/activities/ActivityDrawer";
import { ActivityRow } from "@/features/activities/ActivityRow";
import { HonorDrawer } from "@/features/activities/HonorDrawer";
import { HonorRow } from "@/features/activities/HonorRow";
import { AddSlotRow } from "@/features/activities/RankedRow";
import { SectionStatus } from "@/features/activities/SectionStatus";
import { useActivitiesDeepLink } from "@/features/activities/useActivitiesDeepLink";
import { useReorderDrag } from "@/features/activities/useReorderDrag";
import { useUndoableDelete } from "@/hooks/useUndoableDelete";
import { Award, ListChecks, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";

const activityTypes = new Set(
  activityTypeOptions.map((option) => option.value),
);
const grades = new Set(gradeOptions.map((option) => option.value));
const timingValues = new Set(timingOptions.map((option) => option.value));
const recognitionLevels = new Set(levelOptions.map((option) => option.value));

function isActivityType(value: string): value is ActivityType {
  return activityTypes.has(value as ActivityType);
}

function isGrade(value: string): value is Grade {
  return grades.has(value as Grade);
}

function isTiming(value: string): value is Timing {
  return timingValues.has(value as Timing);
}

function isRecognitionLevel(value: string): value is RecognitionLevel {
  return recognitionLevels.has(value as RecognitionLevel);
}

function sortApiRows<TItem extends { sort_order: number }>(items: TItem[]) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}

function textOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

function activityFromApi(activity: ApiActivity, index: number): Activity {
  const activityType = textOrEmpty(activity.activity_type);

  return {
    id: activity.id,
    order: index + 1,
    type: isActivityType(activityType) ? activityType : "Other Club/Activity",
    position: textOrEmpty(activity.position),
    organization: textOrEmpty(activity.organization),
    description: textOrEmpty(activity.description),
    grades: stringArrayOrEmpty(activity.grades).filter(isGrade),
    timing: stringArrayOrEmpty(activity.timing).filter(isTiming),
    hours_per_week: activity.hours_per_week ?? undefined,
    weeks_per_year: activity.weeks_per_year ?? undefined,
    continue_in_college: activity.continue_in_college ?? undefined,
    story: activity.story ?? undefined,
    created_at: activity.created_at,
    updated_at: activity.updated_at,
  };
}

function honorFromApi(honor: ApiHonor, index: number): Honor {
  return {
    id: honor.id,
    order: index + 1,
    title: textOrEmpty(honor.title),
    grades: stringArrayOrEmpty(honor.grades).filter(isGrade),
    levels: stringArrayOrEmpty(honor.levels).filter(isRecognitionLevel),
    created_at: honor.created_at,
    updated_at: honor.updated_at,
  };
}

function activityPatchToApi(patch: Partial<Activity>): ActivityPatch {
  const next: ActivityPatch = {};

  if ("type" in patch) next.activity_type = patch.type;
  if ("position" in patch) next.position = patch.position;
  if ("organization" in patch) next.organization = patch.organization;
  if ("description" in patch) next.description = patch.description;
  if ("grades" in patch) next.grades = patch.grades;
  if ("timing" in patch) next.timing = patch.timing;
  if ("hours_per_week" in patch) {
    next.hours_per_week = patch.hours_per_week ?? null;
  }
  if ("weeks_per_year" in patch) {
    next.weeks_per_year = patch.weeks_per_year ?? null;
  }
  if ("continue_in_college" in patch) {
    next.continue_in_college = patch.continue_in_college ?? null;
  }
  if ("story" in patch) next.story = patch.story ?? null;

  return next;
}

function honorPatchToApi(patch: Partial<Honor>): HonorPatch {
  const next: HonorPatch = {};

  if ("title" in patch) next.title = patch.title;
  if ("grades" in patch) next.grades = patch.grades;
  if ("levels" in patch) next.levels = patch.levels;

  return next;
}

/** The surface both lists sit on: one raised sheet over the page beams, the
 * same shape as the task lists, rows inset so their hover fill keeps a
 * concentric radius. */
const listSheetClass =
  "rounded-xl border border-[var(--activity-sheet-border)] bg-[var(--activity-sheet-surface)] p-[var(--activity-sheet-inset)] shadow-[var(--elevation-1)]";

const emptySheetClass =
  "rounded-xl border border-dashed border-[var(--edge)] bg-[var(--activity-sheet-surface)] py-12";

function ActivityListSkeleton() {
  return (
    <div className={listSheetClass}>
      {Array.from({ length: 3 }, (_, index) => (
        <div className="flex gap-3 px-3 py-3.5" key={index}>
          <Skeleton className="size-[var(--activity-rank-size)] rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-full max-w-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TabCount({ count, max }: { count: number; max: number }) {
  return (
    <span className="text-xs font-normal text-[var(--ink-faint)] tabular-nums">
      {count}/{max}
    </span>
  );
}

function ListError({
  label,
  onRetry,
}: {
  label: "activities" | "honors";
  onRetry: () => void;
}) {
  return (
    <ErrorCard
      message={`The workspace could not reach your ${label} list.`}
      onRetry={onRetry}
      title={`Could not load ${label}`}
      variant="raised"
    />
  );
}

export function ActivitiesPage() {
  const activitiesQuery = useActivities();
  const honorsQuery = useHonors();
  const createActivityMutation = useCreateActivity();
  const createHonorMutation = useCreateHonor();
  const updateActivityMutation = useUpdateActivity();
  const updateHonorMutation = useUpdateHonor();
  const archiveActivityMutation = useArchiveActivity();
  const archiveHonorMutation = useArchiveHonor();
  const restoreActivityMutation = useRestoreActivity();
  const restoreHonorMutation = useRestoreHonor();
  const reorderActivitiesMutation = useReorderActivities();
  const reorderHonorsMutation = useReorderHonors();
  const [activityPreview, setActivityPreview] = useState<Activity[] | null>(
    null,
  );
  const [honorPreview, setHonorPreview] = useState<Honor[] | null>(null);
  const fetchedActivities = useMemo(
    () => sortApiRows(listOrEmpty(activitiesQuery.data)).map(activityFromApi),
    [activitiesQuery.data],
  );
  const fetchedHonors = useMemo(
    () => sortApiRows(listOrEmpty(honorsQuery.data)).map(honorFromApi),
    [honorsQuery.data],
  );
  const activities = activityPreview ?? fetchedActivities;
  const honors = honorPreview ?? fetchedHonors;

  const {
    activeActivityId,
    activeHonorId,
    closeActivity,
    closeHonor,
    openActivity,
    openHonor,
    setActiveTab,
    visibleTab,
  } = useActivitiesDeepLink({ activities, honors });

  const reduceMotion = useReducedMotion();
  const layout: false | "position" = reduceMotion ? false : "position";

  const activeActivity = activities.find(
    (activity) => activity.id === activeActivityId,
  );
  const activeHonor = honors.find((honor) => honor.id === activeHonorId);

  const activitySlots = useMemo(
    () => getActivitySlots(activities),
    [activities],
  );
  const honorSlots = useMemo(() => getHonorSlots(honors), [honors]);

  function updateActivity(id: string, patch: Partial<Activity>) {
    updateActivityMutation.mutate({ id, patch: activityPatchToApi(patch) });
  }

  function updateHonor(id: string, patch: Partial<Honor>) {
    updateHonorMutation.mutate({ id, patch: honorPatchToApi(patch) });
  }

  const activityDrag = useReorderDrag(
    (draggingId, targetId) =>
      setActivityPreview((current) =>
        renumber(reorderById(current ?? activities, draggingId, targetId)),
      ),
    {
      onCancel: () => {
        setActivityPreview(null);
      },
      onCommit: () => {
        const reordered = activityPreview ?? activities;
        reorderActivitiesMutation.mutate(
          reordered.map((activity) => activity.id),
          { onSettled: () => setActivityPreview(null) },
        );
      },
      onStart: () => {
        setActivityPreview(activities);
      },
    },
  );

  const honorDrag = useReorderDrag(
    (draggingId, targetId) =>
      setHonorPreview((current) =>
        renumber(reorderById(current ?? honors, draggingId, targetId)),
      ),
    {
      onCancel: () => {
        setHonorPreview(null);
      },
      onCommit: () => {
        const reordered = honorPreview ?? honors;
        reorderHonorsMutation.mutate(
          reordered.map((honor) => honor.id),
          { onSettled: () => setHonorPreview(null) },
        );
      },
      onStart: () => {
        setHonorPreview(honors);
      },
    },
  );

  function moveActivity(index: number, direction: -1 | 1) {
    const next = renumber(swapByIndex(activities, index, direction));
    reorderActivitiesMutation.mutate(next.map((activity) => activity.id));
  }

  function moveHonor(index: number, direction: -1 | 1) {
    const next = renumber(swapByIndex(honors, index, direction));
    reorderHonorsMutation.mutate(next.map((honor) => honor.id));
  }

  const activityUndo = useUndoableDelete<Activity>({
    archiveMutation: archiveActivityMutation,
    getLabel: () => "Activity",
    restoreMutation: restoreActivityMutation,
  });

  const honorUndo = useUndoableDelete<Honor>({
    archiveMutation: archiveHonorMutation,
    getLabel: () => "Honor",
    restoreMutation: restoreHonorMutation,
  });

  function deleteActivity(id: string) {
    const activity = activities.find((item) => item.id === id);

    if (!activity) {
      return;
    }

    if (activeActivityId === id) {
      closeActivity();
    }

    honorUndo.clearPending();
    activityUndo.archive(activity);
  }

  function deleteHonor(id: string) {
    const honor = honors.find((item) => item.id === id);

    if (!honor) {
      return;
    }

    if (activeHonorId === id) {
      closeHonor();
    }

    activityUndo.clearPending();
    honorUndo.archive(honor);
  }

  function undoDelete() {
    if (activityUndo.pending) {
      activityUndo.undo();
      return;
    }

    if (honorUndo.pending) {
      honorUndo.undo();
    }
  }

  function dismissUndo() {
    activityUndo.clearPending();
    honorUndo.clearPending();
  }

  async function addActivity() {
    if (activities.length >= MAX_ACTIVITIES) {
      return;
    }

    try {
      const activity = await createActivityMutation.mutateAsync({
        activity_type: "Other Club/Activity",
      });
      openActivity(activity.id);
    } catch {
      // Mutation hook owns optimistic rollback and error toast behavior.
    }
  }

  async function addHonor() {
    if (honors.length >= MAX_HONORS) {
      return;
    }

    try {
      const honor = await createHonorMutation.mutateAsync({});
      openHonor(honor.id);
    } catch {
      // Mutation hook owns optimistic rollback and error toast behavior.
    }
  }

  const activitiesFull = activities.length >= MAX_ACTIVITIES;
  const honorsFull = honors.length >= MAX_HONORS;
  const activeActivityPosition = activeActivity ? activeActivity.order : 0;
  const activeHonorPosition = activeHonor ? activeHonor.order : 0;
  const activeSlots = visibleTab === "activities" ? activitySlots : honorSlots;
  const activeMax = visibleTab === "activities" ? MAX_ACTIVITIES : MAX_HONORS;
  const activeAddLabel =
    visibleTab === "activities"
      ? activitiesFull
        ? "Common App limit reached"
        : "Add activity"
      : honorsFull
        ? "Common App limit reached"
        : "Add honor";
  const activeListUnavailable =
    visibleTab === "activities"
      ? activitiesQuery.isLoading || activitiesQuery.isError
      : honorsQuery.isLoading || honorsQuery.isError;
  const activeAddDisabled =
    visibleTab === "activities"
      ? activitiesFull ||
        activeListUnavailable ||
        createActivityMutation.isPending
      : honorsFull || activeListUnavailable || createHonorMutation.isPending;
  const handleActiveAdd = visibleTab === "activities" ? addActivity : addHonor;

  return (
    <PageContainer
      overlay={
        <UndoToast
          onDismiss={dismissUndo}
          onUndo={undoDelete}
          pending={activityUndo.pending ?? honorUndo.pending}
          reduceMotion={!!reduceMotion}
        />
      }
      title="Activities"
      width="wide"
    >
      <>
        <Tabs
          className="w-full gap-6"
          onValueChange={(value) =>
            setActiveTab(value as "activities" | "honors")
          }
          value={visibleTab}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="w-full sm:w-fit" variant="pill">
              <TabsTab value="activities">
                Activities
                <TabCount count={activities.length} max={MAX_ACTIVITIES} />
              </TabsTab>
              <TabsTab value="honors">
                Honors
                <TabCount count={honors.length} max={MAX_HONORS} />
              </TabsTab>
            </TabsList>
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 lg:justify-end">
              {activeListUnavailable ? null : (
                <SectionStatus max={activeMax} slots={activeSlots} />
              )}
              <Button
                disabled={activeAddDisabled}
                onClick={() => void handleActiveAdd()}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {activeAddLabel}
              </Button>
            </div>
          </div>

          <TabsPanel value="activities">
            {activitiesQuery.isLoading ? (
              <ActivityListSkeleton />
            ) : activitiesQuery.isError ? (
              <ListError
                label="activities"
                onRetry={() => void activitiesQuery.refetch()}
              />
            ) : activities.length === 0 ? (
              <Empty className={emptySheetClass}>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListChecks aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No activities yet</EmptyTitle>
                  <EmptyDescription>
                    Add your most important activity first.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    disabled={createActivityMutation.isPending}
                    onClick={() => void addActivity()}
                    size="sm"
                    type="button"
                  >
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    Add activity
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <ul className={listSheetClass}>
                <AnimatePresence initial={false}>
                  {activities.map((activity, index) => (
                    <ActivityRow
                      activity={activity}
                      index={index}
                      isDragging={activityDrag.draggingId === activity.id}
                      key={activity.id}
                      layout={layout}
                      onArmDrag={activityDrag.armDrag}
                      onDelete={deleteActivity}
                      onDragEnd={activityDrag.handleDragEnd}
                      onDragOver={activityDrag.handleDragOver}
                      onDragStart={activityDrag.handleDragStart}
                      onDrop={activityDrag.handleDrop}
                      onMove={moveActivity}
                      onOpen={openActivity}
                      total={activities.length}
                    />
                  ))}
                </AnimatePresence>
                {!activitiesFull ? (
                  <AddSlotRow
                    disabled={createActivityMutation.isPending}
                    label="Add activity"
                    onAdd={() => void addActivity()}
                    open={MAX_ACTIVITIES - activities.length}
                  />
                ) : null}
              </ul>
            )}
          </TabsPanel>

          <TabsPanel value="honors">
            {honorsQuery.isLoading ? (
              <ActivityListSkeleton />
            ) : honorsQuery.isError ? (
              <ListError
                label="honors"
                onRetry={() => void honorsQuery.refetch()}
              />
            ) : honors.length === 0 ? (
              <Empty className={emptySheetClass}>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Award aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No honors yet</EmptyTitle>
                  <EmptyDescription>
                    Add academic honors, most significant first.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    disabled={createHonorMutation.isPending}
                    onClick={() => void addHonor()}
                    size="sm"
                    type="button"
                  >
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    Add honor
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <ul className={listSheetClass}>
                <AnimatePresence initial={false}>
                  {honors.map((honor, index) => (
                    <HonorRow
                      honor={honor}
                      index={index}
                      isDragging={honorDrag.draggingId === honor.id}
                      key={honor.id}
                      layout={layout}
                      onArmDrag={honorDrag.armDrag}
                      onDelete={deleteHonor}
                      onDragEnd={honorDrag.handleDragEnd}
                      onDragOver={honorDrag.handleDragOver}
                      onDragStart={honorDrag.handleDragStart}
                      onDrop={honorDrag.handleDrop}
                      onMove={moveHonor}
                      onOpen={openHonor}
                      total={honors.length}
                    />
                  ))}
                </AnimatePresence>
                {!honorsFull ? (
                  <AddSlotRow
                    disabled={createHonorMutation.isPending}
                    label="Add honor"
                    onAdd={() => void addHonor()}
                    open={MAX_HONORS - honors.length}
                  />
                ) : null}
              </ul>
            )}
          </TabsPanel>
        </Tabs>

        <ActivityDrawer
          activity={activeActivity}
          onDelete={deleteActivity}
          onMove={moveActivity}
          onOpenChange={(open) => {
            if (!open) {
              closeActivity();
            }
          }}
          onUpdate={updateActivity}
          open={!!activeActivity}
          position={activeActivityPosition}
          total={activities.length}
        />

        <HonorDrawer
          honor={activeHonor}
          onDelete={deleteHonor}
          onMove={moveHonor}
          onOpenChange={(open) => {
            if (!open) {
              closeHonor();
            }
          }}
          onUpdate={updateHonor}
          open={!!activeHonor}
          position={activeHonorPosition}
          total={honors.length}
        />
      </>
    </PageContainer>
  );
}
