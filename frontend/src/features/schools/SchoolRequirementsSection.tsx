import { useMemo } from "react";
import { useNavigate } from "react-router";

import type {
  ApplicationDetail,
  ApplicationPatch,
  ApplicationView,
  EssaySummary,
  SchoolRequirement,
} from "@/api/workspace/types";
import {
  useCompleteTask,
  useScheduleTask,
  useToggleFlag,
} from "@/api/workspace/hooks";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { taskFromApi } from "@/domain/task";
import { Provenance } from "@/features/schools/school-workspace-fields";
import {
  applicabilityLabels,
  audienceDescription,
  commonRequirements,
  humanize,
  referenceDetail,
} from "@/features/schools/school-workspace-format";
import type { CommonRequirement } from "@/features/schools/school-workspace-format";
import { QuickAddBar } from "@/features/tasks/QuickAddBar";
import { TaskRow } from "@/features/tasks/TaskRow";

/* Extracted verbatim from SchoolWorkspace.tsx (the 800-line limit). */

export function SchoolRequirementsSection({
  detail,
  patchApplication,
}: {
  detail: ApplicationDetail;
  patchApplication: (patch: ApplicationPatch) => void;
}) {
  const navigate = useNavigate();
  const completeTaskMutation = useCompleteTask();
  const scheduleTaskMutation = useScheduleTask();
  const toggleFlagMutation = useToggleFlag();

  // A single-entry map (this application) plus this application's own
  // essays — exactly what `TaskRow`'s derived-label lookup needs, built
  // locally rather than threaded down from a page-level query.
  const applicationsById = useMemo<ReadonlyMap<string, ApplicationView>>(
    () => new Map([[detail.application.id, detail.application]]),
    [detail.application],
  );
  const essaysById = useMemo<ReadonlyMap<string, EssaySummary>>(
    () => new Map(detail.essays.map((essay) => [essay.id, essay])),
    [detail.essays],
  );

  function openTask(taskId: string) {
    // Keeps the pre-existing deep-link behaviour: `/app/tasks?task=<id>`
    // opens the redesigned Tasks page with that task's detail panel open.
    navigate(`/app/tasks?task=${taskId}`);
  }

  function handleComplete(taskId: string, done: boolean) {
    completeTaskMutation.mutate({ id: taskId, done });
  }

  function handleSchedule(
    taskId: string,
    field: "when_on" | "deadline_on",
    value: string | null,
  ) {
    scheduleTaskMutation.mutate({ id: taskId, field, value });
  }

  function handleToggleFlag(taskId: string) {
    const task = detail.tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }
    toggleFlagMutation.mutate({ id: taskId, flagged: !task.flagged });
  }

  const visibleRequirements = useMemo(
    () =>
      detail.reference.status === "loaded" ? detail.reference.requirements : [],
    [detail.reference],
  );
  const catalogByKind = useMemo(
    () => new Map(visibleRequirements.map((item) => [item.kind, item])),
    [visibleRequirements],
  );
  const rows = useMemo(() => {
    const known = commonRequirements.map((common) => ({
      common,
      reference: catalogByKind.get(common.kind),
    }));
    const knownKinds = new Set(commonRequirements.map((item) => item.kind));
    const catalogOnly = visibleRequirements
      .filter((item) => !knownKinds.has(item.kind))
      .map(
        (
          reference,
        ): { common: CommonRequirement; reference: SchoolRequirement } => ({
          common: {
            kind: reference.kind,
            label: reference.label,
            category: "other",
          },
          reference,
        }),
      );
    return [...known, ...catalogOnly];
  }, [catalogByKind, visibleRequirements]);
  const schoolRows = rows.filter((row) => row.reference);
  const verifyRows = rows.filter((row) => !row.reference);
  function renderRows(items: typeof rows) {
    return items.map(({ common, reference }) => {
      const tasks = detail.tasks.filter(
        (task) => task.requirement_kind === common.kind,
      );
      const status = common.trackable
        ? detail.application.checklist?.[common.trackable]?.status
        : undefined;
      const cannotTrack = reference?.applicability === "not_required";
      return (
        <AccordionItem key={common.kind} value={common.kind}>
          <AccordionTrigger>
            <span className="flex min-w-0 flex-1 items-center justify-between gap-4 pr-2">
              <span>{reference?.label ?? common.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={reference ? "secondary" : "outline"}>
                  {reference
                    ? applicabilityLabels[reference.applicability]
                    : "Verify"}
                </Badge>
                {tasks.length ? (
                  <span className="text-xs text-muted-foreground">
                    {tasks.length} task{tasks.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionPanel className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-wide text-foreground uppercase">
                  School requirement
                </p>
                {reference ? (
                  <>
                    <p className="text-sm text-foreground">
                      {applicabilityLabels[reference.applicability]}
                    </p>
                    {referenceDetail(reference) ? (
                      <p>{referenceDetail(reference)}</p>
                    ) : null}
                    {reference.applicability === "conditional" ? (
                      <p className="text-warning">
                        Verify whether this applies to you
                        {audienceDescription(reference.audience)
                          ? `: ${audienceDescription(reference.audience)}`
                          : "."}
                      </p>
                    ) : null}
                    <Provenance provenance={reference.provenance} />
                  </>
                ) : (
                  <p>
                    {detail.reference.status === "cycle_required"
                      ? "Generic common item only. Confirm the application cycle, then verify it with the school."
                      : "Not in the published catalog. Verify this common item with the school website."}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-wide text-foreground uppercase">
                  Your tracking
                </p>
                {common.trackable && !cannotTrack ? (
                  <Select
                    onValueChange={(next) =>
                      patchApplication({
                        checklist: {
                          [common.trackable!]:
                            next === "not_tracked"
                              ? null
                              : {
                                  status: next,
                                  updated_at: new Date().toISOString(),
                                },
                        },
                      })
                    }
                    value={status ?? "not_tracked"}
                  >
                    <SelectTrigger
                      aria-label={`Tracking status for ${common.label}`}
                      size="sm"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectGroup>
                        <SelectItem value="not_tracked">Not tracked</SelectItem>
                        {common.statuses?.map((option) => (
                          <SelectItem key={option} value={option}>
                            {humanize(option)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectPopup>
                  </Select>
                ) : (
                  <p>
                    {cannotTrack
                      ? "No tracking needed for a cataloged not-required item."
                      : "Coordination is tracked through your tasks, not as school receipt status."}
                  </p>
                )}
              </div>
            </div>
            {tasks.length > 0 ? (
              <div className="flex flex-col gap-2">
                {cannotTrack ? (
                  <p className="text-sm text-warning">
                    Review inconsistency: this item is published as not
                    required, but legacy tasks are still linked. They are
                    preserved for you to review.
                  </p>
                ) : null}
                <ul className="-mx-2 flex flex-col" role="list">
                  {tasks.map((task) => (
                    <TaskRow
                      applicationsById={applicationsById}
                      essaysById={essaysById}
                      isSelected={false}
                      key={task.id}
                      onComplete={handleComplete}
                      onOpen={openTask}
                      onSchedule={handleSchedule}
                      onToggleFlag={handleToggleFlag}
                      suppress={{ label: true }}
                      task={taskFromApi(task)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            {!cannotTrack ? (
              <QuickAddBar
                applications={[detail.application]}
                defaults={{
                  application_id: detail.application.id,
                  requirement_kind: common.kind,
                }}
                essays={detail.essays}
              />
            ) : null}
          </AccordionPanel>
        </AccordionItem>
      );
    });
  }
  return (
    <section className="flex scroll-mt-20 flex-col gap-5" id="requirements">
      <div>
        <h2 className="font-heading text-xl font-medium">Requirements</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          School facts and your own tracking are intentionally separate. Receipt
          status lives in the application portal.
        </p>
      </div>
      {schoolRows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Published school requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion multiple>{renderRows(schoolRows)}</Accordion>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Common items to verify</CardTitle>
        </CardHeader>
        <CardContent>
          {verifyRows.length ? (
            <Accordion multiple>{renderRows(verifyRows)}</Accordion>
          ) : (
            <p className="text-sm text-muted-foreground">
              Every common item is covered by the published catalog for this
              cycle.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
