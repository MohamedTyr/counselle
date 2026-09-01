import { useMemo } from "react";
import { Link } from "react-router";

import type {
  ApplicationDetail,
  ApplicationPatch,
  SchoolRequirement,
} from "@/api/workspace/types";
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
import {
  Provenance,
  QuickAddTask,
} from "@/features/schools/school-workspace-fields";
import {
  applicabilityLabels,
  audienceDescription,
  commonRequirements,
  humanize,
  referenceDetail,
} from "@/features/schools/school-workspace-format";
import type { CommonRequirement } from "@/features/schools/school-workspace-format";

/* Extracted verbatim from SchoolWorkspace.tsx (the 800-line limit). */

export function SchoolRequirementsSection({
  detail,
  patchApplication,
}: {
  detail: ApplicationDetail;
  patchApplication: (patch: ApplicationPatch) => void;
}) {
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
                {tasks.map((task) => (
                  <Link
                    className="rounded-md border px-3 py-2 text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
                    key={task.id}
                    to={`/app/tasks?task=${task.id}`}
                  >
                    {task.title}
                  </Link>
                ))}
              </div>
            ) : null}
            {!cannotTrack ? (
              <QuickAddTask
                applicationId={detail.application.id}
                category={common.category}
                requirementKind={common.kind}
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
