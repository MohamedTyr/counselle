import { useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { UndoToast } from "@/components/undo-toast";
import { PageHeader } from "@/components/workspace/PageHeader";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  MAX_ACTIVITIES,
  MAX_HONORS,
  type Activity,
  type Honor,
} from "@/domain/activity";
import { initialActivities, initialHonors } from "@/fixtures/activities";
import {
  createActivity,
  createHonor,
  getActivityStats,
  getHonorStats,
  insertAt,
  removeById,
  updateItemById,
} from "@/features/activities/activities-mutations";
import {
  renumber,
  reorderById,
  swapByIndex,
} from "@/features/activities/activities-reorder";
import type { ActivitiesPageProps } from "@/features/activities/activities-types";
import { ActivityDrawer } from "@/features/activities/ActivityDrawer";
import { ActivityRow } from "@/features/activities/ActivityRow";
import { HonorDrawer } from "@/features/activities/HonorDrawer";
import { HonorRow } from "@/features/activities/HonorRow";
import { SectionStatus } from "@/features/activities/SectionStatus";
import { useActivitiesDeepLink } from "@/features/activities/useActivitiesDeepLink";
import { useReorderDrag } from "@/features/activities/useReorderDrag";
import { useUndoableDelete } from "@/hooks/useUndoableDelete";
import { Award, ListChecks, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";

export function ActivitiesPage({
  activities: controlledActivities,
  onActivitiesChange,
  honors: controlledHonors,
  onHonorsChange,
}: ActivitiesPageProps = {}) {
  const [localActivities, setLocalActivities] =
    useState<Activity[]>(initialActivities);
  const [localHonors, setLocalHonors] = useState<Honor[]>(initialHonors);
  const activities = controlledActivities ?? localActivities;
  const setActivities = onActivitiesChange ?? setLocalActivities;
  const honors = controlledHonors ?? localHonors;
  const setHonors = onHonorsChange ?? setLocalHonors;

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

  const archivedActivityRef = useRef<{
    index: number;
    item: Activity;
  } | null>(null);
  const archivedHonorRef = useRef<{ index: number; item: Honor } | null>(null);
  const activityDragSnapshotRef = useRef<Activity[] | null>(null);
  const honorDragSnapshotRef = useRef<Honor[] | null>(null);
  const reduceMotion = useReducedMotion();
  const layout: false | "position" = reduceMotion ? false : "position";

  const activeActivity = activities.find(
    (activity) => activity.id === activeActivityId,
  );
  const activeHonor = honors.find((honor) => honor.id === activeHonorId);

  const activityStats = useMemo(
    () => getActivityStats(activities),
    [activities],
  );
  const honorStats = useMemo(() => getHonorStats(honors), [honors]);

  function updateActivity(id: string, patch: Partial<Activity>) {
    setActivities((current) => updateItemById(current, id, patch));
  }

  function updateHonor(id: string, patch: Partial<Honor>) {
    setHonors((current) => updateItemById(current, id, patch));
  }

  const activityDrag = useReorderDrag(
    (draggingId, targetId) =>
      setActivities((current) =>
        renumber(reorderById(current, draggingId, targetId)),
      ),
    {
      onCancel: () => {
        if (activityDragSnapshotRef.current) {
          setActivities(activityDragSnapshotRef.current);
          activityDragSnapshotRef.current = null;
        }
      },
      onCommit: () => {
        activityDragSnapshotRef.current = null;
      },
      onStart: () => {
        activityDragSnapshotRef.current = activities;
      },
    },
  );

  const honorDrag = useReorderDrag(
    (draggingId, targetId) =>
      setHonors((current) =>
        renumber(reorderById(current, draggingId, targetId)),
      ),
    {
      onCancel: () => {
        if (honorDragSnapshotRef.current) {
          setHonors(honorDragSnapshotRef.current);
          honorDragSnapshotRef.current = null;
        }
      },
      onCommit: () => {
        honorDragSnapshotRef.current = null;
      },
      onStart: () => {
        honorDragSnapshotRef.current = honors;
      },
    },
  );

  function moveActivity(index: number, direction: -1 | 1) {
    setActivities((current) =>
      renumber(swapByIndex(current, index, direction)),
    );
  }

  function moveHonor(index: number, direction: -1 | 1) {
    setHonors((current) => renumber(swapByIndex(current, index, direction)));
  }

  // Phase 4 transitional adapter: Activities stays fixture-backed until Phase 8,
  // but delete/undo already uses the shared archive/restore hook surface.
  const activityUndo = useUndoableDelete<Activity>({
    archiveMutation: {
      mutate: (id, options) => {
        const removed = removeById(activities, id);
        if (!removed) {
          options?.onError?.(new Error("Activity not found"));
          return;
        }
        archivedActivityRef.current = removed;
        setActivities(removed.next);
      },
    },
    getLabel: () => "Activity",
    restoreMutation: {
      mutate: (id) => {
        const archived = archivedActivityRef.current;
        if (!archived || archived.item.id !== id) {
          return;
        }
        setActivities((current) =>
          insertAt(current, archived.item, archived.index),
        );
        archivedActivityRef.current = null;
      },
    },
  });

  const honorUndo = useUndoableDelete<Honor>({
    archiveMutation: {
      mutate: (id, options) => {
        const removed = removeById(honors, id);
        if (!removed) {
          options?.onError?.(new Error("Honor not found"));
          return;
        }
        archivedHonorRef.current = removed;
        setHonors(removed.next);
      },
    },
    getLabel: () => "Honor",
    restoreMutation: {
      mutate: (id) => {
        const archived = archivedHonorRef.current;
        if (!archived || archived.item.id !== id) {
          return;
        }
        setHonors((current) => insertAt(current, archived.item, archived.index));
        archivedHonorRef.current = null;
      },
    },
  });

  function deleteActivity(id: string) {
    const activity = activities.find((item) => item.id === id);

    if (!activity) {
      return;
    }

    if (activeActivityId === id) {
      closeActivity();
    }

    archivedHonorRef.current = null;
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

    archivedActivityRef.current = null;
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
    archivedActivityRef.current = null;
    archivedHonorRef.current = null;
    activityUndo.clearPending();
    honorUndo.clearPending();
  }

  function addActivity() {
    if (activities.length >= MAX_ACTIVITIES) {
      return;
    }

    const activity = createActivity(activities.length);

    setActivities((current) => [...current, activity]);
    openActivity(activity.id);
  }

  function addHonor() {
    if (honors.length >= MAX_HONORS) {
      return;
    }

    const honor = createHonor(honors.length);

    setHonors((current) => [...current, honor]);
    openHonor(honor.id);
  }

  const activitiesFull = activities.length >= MAX_ACTIVITIES;
  const honorsFull = honors.length >= MAX_HONORS;
  const activeActivityPosition = activeActivity ? activeActivity.order : 0;
  const activeHonorPosition = activeHonor ? activeHonor.order : 0;
  const activeStats = visibleTab === "activities" ? activityStats : honorStats;
  const activeAddLabel =
    visibleTab === "activities"
      ? activitiesFull
        ? "Common App limit reached"
        : "Add activity"
      : honorsFull
        ? "Common App limit reached"
        : "Add honor";
  const activeAddDisabled =
    visibleTab === "activities" ? activitiesFull : honorsFull;
  const handleActiveAdd = visibleTab === "activities" ? addActivity : addHonor;

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
        <PageHeader title="Activities" />

        <Tabs
          className="mx-auto w-full max-w-4xl gap-5"
          onValueChange={(value) =>
            setActiveTab(value as "activities" | "honors")
          }
          value={visibleTab}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="w-full justify-start sm:w-fit">
              <TabsTab
                className="h-8 px-3 text-sm sm:h-8 sm:px-3 sm:text-sm"
                value="activities"
              >
                Activities
                <span className="text-xs text-muted-foreground tabular-nums">
                  {activities.length}/{MAX_ACTIVITIES}
                </span>
              </TabsTab>
              <TabsTab
                className="h-8 px-3 text-sm sm:h-8 sm:px-3 sm:text-sm"
                value="honors"
              >
                Honors
                <span className="text-xs text-muted-foreground tabular-nums">
                  {honors.length}/{MAX_HONORS}
                </span>
              </TabsTab>
            </TabsList>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
              <SectionStatus
                className="sm:justify-end"
                notReady={activeStats.notReady}
                overLimit={activeStats.overLimit}
                ready={activeStats.ready}
              />
              <Button
                disabled={activeAddDisabled}
                onClick={handleActiveAdd}
                className="h-8 w-fit px-3 text-sm"
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {activeAddLabel}
              </Button>
            </div>
          </div>

          <TabsPanel className="flex flex-col gap-4" value="activities">
            {activities.length === 0 ? (
              <Empty className="min-h-56 rounded-xl border border-dashed bg-muted/20 py-12">
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
                  <Button onClick={addActivity} size="sm" type="button">
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    Add activity
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="rounded-xl border border-[color:var(--activity-list-border)] bg-[color:var(--activity-list-surface)] p-1.5">
                <div className="flex flex-col">
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
                </div>

                {!activitiesFull ? (
                  <button
                    className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--activity-row-border)] py-3 text-xs text-muted-foreground transition-colors hover:bg-[color:var(--activity-row-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:outline-none"
                    onClick={addActivity}
                    type="button"
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    {MAX_ACTIVITIES - activities.length} open{" "}
                    {MAX_ACTIVITIES - activities.length === 1
                      ? "slot"
                      : "slots"}{" "}
                    - add activity
                  </button>
                ) : null}
              </div>
            )}
          </TabsPanel>

          <TabsPanel className="flex flex-col gap-4" value="honors">
            {honors.length === 0 ? (
              <Empty className="min-h-48 rounded-xl border border-dashed bg-muted/20 py-10">
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
                  <Button onClick={addHonor} size="sm" type="button">
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    Add honor
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="rounded-xl border border-[color:var(--activity-list-border)] bg-[color:var(--activity-list-surface)] p-1.5">
                <div className="flex flex-col">
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
                </div>
              </div>
            )}
          </TabsPanel>
        </Tabs>
      </div>

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

      <UndoToast
        onDismiss={dismissUndo}
        onUndo={undoDelete}
        pending={activityUndo.pending ?? honorUndo.pending}
        reduceMotion={!!reduceMotion}
      />
    </section>
  );
}
