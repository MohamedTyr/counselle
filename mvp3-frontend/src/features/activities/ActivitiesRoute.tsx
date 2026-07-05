import { useEffect, useMemo, useRef, useState } from "react"
import { useReducedMotion } from "motion/react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import {
  MAX_ACTIVITIES,
  MAX_HONORS,
  type Activity,
  type Honor,
} from "@/domain/activity"
import { initialActivities, initialHonors } from "@/fixtures/activities"
import { UNDO_WINDOW_MS } from "@/features/activities/activities-config"
import {
  createActivity,
  createHonor,
  getActivityStats,
  getHonorStats,
  insertAt,
  removeById,
  updateItemById,
} from "@/features/activities/activities-mutations"
import {
  renumber,
  reorderById,
  swapByIndex,
} from "@/features/activities/activities-reorder"
import type {
  ActivitiesPageProps,
  PendingDelete,
} from "@/features/activities/activities-types"
import { ActivityDrawer } from "@/features/activities/ActivityDrawer"
import { ActivityRow } from "@/features/activities/ActivityRow"
import { HonorDrawer } from "@/features/activities/HonorDrawer"
import { HonorRow } from "@/features/activities/HonorRow"
import { SectionStatus } from "@/features/activities/SectionStatus"
import { UndoToast } from "@/features/activities/UndoToast"
import { useActivitiesDeepLink } from "@/features/activities/useActivitiesDeepLink"
import { useReorderDrag } from "@/features/activities/useReorderDrag"
import { Award, ListChecks, Plus } from "lucide-react"
import { AnimatePresence } from "motion/react"

export function ActivitiesPage({
  activities: controlledActivities,
  onActivitiesChange,
  honors: controlledHonors,
  onHonorsChange,
}: ActivitiesPageProps = {}) {
  const [localActivities, setLocalActivities] =
    useState<Activity[]>(initialActivities)
  const [localHonors, setLocalHonors] = useState<Honor[]>(initialHonors)
  const activities = controlledActivities ?? localActivities
  const setActivities = onActivitiesChange ?? setLocalActivities
  const honors = controlledHonors ?? localHonors
  const setHonors = onHonorsChange ?? setLocalHonors

  const {
    activeActivityId,
    activeHonorId,
    closeActivity,
    closeHonor,
    openActivity,
    openHonor,
    setActiveTab,
    visibleTab,
  } = useActivitiesDeepLink({ activities, honors })

  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)
  const deleteTimeoutRef = useRef<number | undefined>(undefined)
  const reduceMotion = useReducedMotion()
  const layout: false | "position" = reduceMotion ? false : "position"

  const activeActivity = activities.find(
    (activity) => activity.id === activeActivityId
  )
  const activeHonor = honors.find((honor) => honor.id === activeHonorId)

  const activityStats = useMemo(
    () => getActivityStats(activities),
    [activities]
  )
  const honorStats = useMemo(() => getHonorStats(honors), [honors])

  useEffect(() => () => window.clearTimeout(deleteTimeoutRef.current), [])

  function updateActivity(id: string, patch: Partial<Activity>) {
    setActivities((current) => updateItemById(current, id, patch))
  }

  function updateHonor(id: string, patch: Partial<Honor>) {
    setHonors((current) => updateItemById(current, id, patch))
  }

  const activityDrag = useReorderDrag((draggingId, targetId) =>
    setActivities((current) =>
      renumber(reorderById(current, draggingId, targetId))
    )
  )

  const honorDrag = useReorderDrag((draggingId, targetId) =>
    setHonors((current) => renumber(reorderById(current, draggingId, targetId)))
  )

  function moveActivity(index: number, direction: -1 | 1) {
    setActivities((current) => renumber(swapByIndex(current, index, direction)))
  }

  function moveHonor(index: number, direction: -1 | 1) {
    setHonors((current) => renumber(swapByIndex(current, index, direction)))
  }

  function scheduleDeleteCleanup() {
    window.clearTimeout(deleteTimeoutRef.current)
    deleteTimeoutRef.current = window.setTimeout(
      () => setPendingDelete(null),
      UNDO_WINDOW_MS
    )
  }

  function deleteActivity(id: string) {
    const removed = removeById(activities, id)

    if (!removed) {
      return
    }

    if (activeActivityId === id) {
      closeActivity()
    }

    setActivities(removed.next)
    setPendingDelete({
      index: removed.index,
      item: removed.item,
      kind: "activity",
    })
    scheduleDeleteCleanup()
  }

  function deleteHonor(id: string) {
    const removed = removeById(honors, id)

    if (!removed) {
      return
    }

    if (activeHonorId === id) {
      closeHonor()
    }

    setHonors(removed.next)
    setPendingDelete({
      index: removed.index,
      item: removed.item,
      kind: "honor",
    })
    scheduleDeleteCleanup()
  }

  function undoDelete() {
    if (!pendingDelete) {
      return
    }

    if (pendingDelete.kind === "activity") {
      const restored = pendingDelete
      setActivities((current) =>
        insertAt(current, restored.item, restored.index)
      )
    } else {
      const restored = pendingDelete
      setHonors((current) => insertAt(current, restored.item, restored.index))
    }

    window.clearTimeout(deleteTimeoutRef.current)
    setPendingDelete(null)
  }

  function addActivity() {
    if (activities.length >= MAX_ACTIVITIES) {
      return
    }

    const activity = createActivity(activities.length)

    setActivities((current) => [...current, activity])
    openActivity(activity.id)
  }

  function addHonor() {
    if (honors.length >= MAX_HONORS) {
      return
    }

    const honor = createHonor(honors.length)

    setHonors((current) => [...current, honor])
    openHonor(honor.id)
  }

  const activitiesFull = activities.length >= MAX_ACTIVITIES
  const honorsFull = honors.length >= MAX_HONORS
  const activeActivityPosition = activeActivity ? activeActivity.order : 0
  const activeHonorPosition = activeHonor ? activeHonor.order : 0

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-page="activities"
    >
      <div className="workspace-scrollbar mx-auto flex min-h-0 w-full max-w-4xl min-w-0 flex-col gap-8 overflow-y-auto p-6">
        <header className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Applications</p>
          <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
        </header>

        <Tabs
          className="gap-5"
          onValueChange={(value) =>
            setActiveTab(value as "activities" | "honors")
          }
          value={visibleTab}
        >
          <TabsPanel className="flex flex-col gap-4" value="activities">
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
                  notReady={activityStats.notReady}
                  overLimit={activityStats.overLimit}
                  ready={activityStats.ready}
                />
                <Button
                  disabled={activitiesFull}
                  onClick={addActivity}
                  className="h-8 w-fit px-3 text-sm"
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  {activitiesFull ? "Common App limit reached" : "Add activity"}
                </Button>
              </div>
            </div>

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
              <div className="rounded-2xl border bg-card/40 p-1.5 shadow-xs/5">
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
                        onMove={moveActivity}
                        onOpen={openActivity}
                        total={activities.length}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {!activitiesFull ? (
                  <button
                    className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-3 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:outline-none"
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
                  notReady={honorStats.notReady}
                  overLimit={honorStats.overLimit}
                  ready={honorStats.ready}
                />
                <Button
                  disabled={honorsFull}
                  onClick={addHonor}
                  className="h-8 w-fit px-3 text-sm"
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  {honorsFull ? "Common App limit reached" : "Add honor"}
                </Button>
              </div>
            </div>

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
              <div className="rounded-2xl border bg-card/40 p-1.5 shadow-xs/5">
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
            closeActivity()
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
            closeHonor()
          }
        }}
        onUpdate={updateHonor}
        open={!!activeHonor}
        position={activeHonorPosition}
        total={honors.length}
      />

      <UndoToast
        onDismiss={() => {
          window.clearTimeout(deleteTimeoutRef.current)
          setPendingDelete(null)
        }}
        onUndo={undoDelete}
        pending={pendingDelete}
        reduceMotion={!!reduceMotion}
      />
    </section>
  )
}
