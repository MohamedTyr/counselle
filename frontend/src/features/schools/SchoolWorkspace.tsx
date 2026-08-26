import { ExternalLink, FilePenLine, ListChecks, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useUpdateApplication } from "@/api/workspace/hooks";
import type {
  ApplicationDetail,
  ApplicationPatch,
  ApplicationPlatform,
  ApplicationStatus,
  ListType,
  Round,
  TestPlan,
} from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SchoolEssaysSection as EssaysSection } from "@/features/schools/SchoolEssaysSection";
import { SchoolRequirementsSection as RequirementsSection } from "@/features/schools/SchoolRequirementsSection";
import { FieldSelect } from "@/features/schools/school-workspace-fields";
import {
  cycleLabel,
  useSyncedDraft,
} from "@/features/schools/school-workspace-format";

const statuses: ApplicationStatus[] = [
  "Considering",
  "Applying",
  "Submitted",
  "Deferred",
  "Accepted",
  "Enrolled",
  "Rejected",
  "Waitlisted",
  "Withdrawn",
];
const listTypes: ListType[] = ["Reach", "Target", "Safety"];
const rounds: Round[] = ["EA", "ED", "ED2", "REA", "RD", "Rolling", "Priority"];
const testPlans: TestPlan[] = ["submit", "withhold", "undecided"];
const platforms: ApplicationPlatform[] = [
  "common_app",
  "coalition",
  "school_portal",
  "direct",
  "other",
];
type PlatformSelection = ApplicationPlatform | "not_set";
const platformSelections: PlatformSelection[] = ["not_set", ...platforms];
const MIN_CYCLE_YEAR = 2020;
const MAX_CYCLE_YEAR = 2100;
const platformLabels: Record<ApplicationPlatform, string> = {
  common_app: "Common App",
  coalition: "Coalition",
  school_portal: "School portal",
  direct: "Direct",
  other: "Other",
};
const platformSelectionLabels: Record<PlatformSelection, string> = {
  not_set: "Not set",
  ...platformLabels,
};

export function SchoolWorkspace({
  detail,
  onRetry,
}: {
  detail: ApplicationDetail;
  onRetry: () => void;
}) {
  const application = detail.application;
  const updateApplication = useUpdateApplication();
  const majorDraft = useSyncedDraft(application.intended_major ?? "");
  const deadlineDraft = useSyncedDraft(application.deadline ?? "");
  const cycleDraft = useSyncedDraft(
    application.cycle_year ? String(application.cycle_year) : "",
  );
  const notesDraft = useSyncedDraft(application.notes ?? "");
  const platformDraft = useSyncedDraft<PlatformSelection>(
    application.platform ?? "not_set",
  );
  const platformOtherDraft = useSyncedDraft(application.platform_other ?? "");
  function patchApplication(patch: ApplicationPatch) {
    updateApplication.mutate({ id: application.id, patch });
  }
  return (
    /*
     * The application tab. The school's identity — avatar, name, place,
     * website, add/archive — lives in the page header now, shared with the
     * About tab, because it does not belong to either one of them.
     */
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {cycleLabel(application.cycle_year)}
          </p>
          <Button onClick={onRetry} size="sm" variant="ghost">
            <RefreshCw data-icon="inline-start" />
            Refresh reference
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <FieldSelect
            label="Status"
            onChange={(status) => patchApplication({ status })}
            options={statuses}
            value={application.status}
          />
          <FieldSelect
            label="List"
            onChange={(list_type) => patchApplication({ list_type })}
            options={listTypes}
            value={application.list_type}
          />
          <FieldSelect
            label="Round"
            onChange={(round) => patchApplication({ round })}
            options={rounds}
            value={application.round}
          />
          <FieldSelect
            label="Test plan"
            onChange={(test_plan) => patchApplication({ test_plan })}
            options={testPlans}
            value={application.test_plan ?? "undecided"}
          />
          <FieldSelect
            label="Platform"
            labels={platformSelectionLabels}
            onChange={(platform) => {
              platformDraft.setValue(platform);
              if (platform !== "other") {
                patchApplication({
                  platform: platform === "not_set" ? null : platform,
                  platform_other: null,
                });
                platformDraft.commit();
                platformOtherDraft.revert();
              }
            }}
            options={platformSelections}
            value={platformDraft.value}
          />
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Cycle year
            <Input
              nativeInput
              max={MAX_CYCLE_YEAR}
              min={MIN_CYCLE_YEAR}
              onBlur={() => {
                if (!cycleDraft.value) {
                  if (application.cycle_year !== null) {
                    cycleDraft.revert();
                    toast.error(
                      "A confirmed application cycle cannot be cleared",
                    );
                  } else {
                    cycleDraft.commit();
                  }
                  return;
                }
                const year = Number(cycleDraft.value);
                if (
                  Number.isInteger(year) &&
                  year >= MIN_CYCLE_YEAR &&
                  year <= MAX_CYCLE_YEAR
                ) {
                  patchApplication({ cycle_year: year });
                  cycleDraft.commit();
                } else {
                  cycleDraft.revert();
                  toast.error(
                    `Enter a whole cycle year from ${MIN_CYCLE_YEAR} to ${MAX_CYCLE_YEAR}`,
                  );
                }
              }}
              onChange={(event) =>
                cycleDraft.setValue(event.currentTarget.value)
              }
              placeholder="2027"
              type="number"
              value={cycleDraft.value}
            />
          </label>
        </div>
        {platformDraft.value === "other" ? (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Other application platform
            <Input
              nativeInput
              onBlur={() => {
                const name = platformOtherDraft.value.trim();
                if (name) {
                  patchApplication({
                    platform: "other",
                    platform_other: name,
                  });
                  platformDraft.commit();
                  platformOtherDraft.commit();
                } else {
                  platformDraft.revert();
                  platformOtherDraft.revert();
                  toast.error(
                    "Other was not saved because the platform name is empty",
                  );
                }
              }}
              onChange={(event) =>
                platformOtherDraft.setValue(event.currentTarget.value)
              }
              placeholder="Name the platform"
              value={platformOtherDraft.value}
            />
            <span
              className={
                platformDraft.dirty || platformOtherDraft.dirty
                  ? "font-normal text-warning"
                  : "font-normal text-muted-foreground"
              }
            >
              {platformDraft.dirty || platformOtherDraft.dirty
                ? "Draft until a non-empty name is saved."
                : "Saved as Other."}
            </span>
          </label>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Intended major
            <Input
              nativeInput
              onBlur={() => {
                patchApplication({
                  intended_major: majorDraft.value || null,
                });
                majorDraft.commit();
              }}
              onChange={(event) =>
                majorDraft.setValue(event.currentTarget.value)
              }
              placeholder="Not set"
              value={majorDraft.value}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Application deadline
            <Input
              nativeInput
              onBlur={() => {
                patchApplication({ deadline: deadlineDraft.value || null });
                deadlineDraft.commit();
              }}
              onChange={(event) =>
                deadlineDraft.setValue(event.currentTarget.value)
              }
              type="date"
              value={deadlineDraft.value}
            />
          </label>
        </div>
        {detail.reference.status === "loaded" &&
        detail.reference.test_policy ? (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>
              Published testing policy:{" "}
              {detail.reference.test_policy.display ??
                (detail.reference.test_policy.raw == null
                  ? "Unavailable for this application cycle"
                  : String(detail.reference.test_policy.raw))}
              {detail.reference.test_policy.citation?.caveat
                ? ` · ${detail.reference.test_policy.citation.caveat}`
                : ""}
            </p>
            {detail.reference.test_policy.citation?.source ||
            detail.reference.test_policy.citation?.vintage ? (
              <p className="text-xs">
                {detail.reference.test_policy.citation.url ? (
                  <a
                    className="underline underline-offset-3 hover:text-foreground"
                    href={detail.reference.test_policy.citation.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {detail.reference.test_policy.citation.source ?? "Source"}{" "}
                    <ExternalLink className="inline size-3" />
                  </a>
                ) : (
                  (detail.reference.test_policy.citation.source ??
                  "Source unavailable")
                )}
                {detail.reference.test_policy.citation.vintage
                  ? ` · ${detail.reference.test_policy.citation.vintage}`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </header>
      <nav
        aria-label="School workspace sections"
        className="sticky top-0 z-10 -mx-2 flex gap-1 overflow-x-auto border-y bg-[color-mix(in_oklch,var(--canvas)_95%,transparent)] px-2 py-2 backdrop-blur"
      >
        <Button render={<a href="#essays" />} size="sm" variant="ghost">
          <FilePenLine data-icon="inline-start" />
          Essays
        </Button>
        <Button render={<a href="#requirements" />} size="sm" variant="ghost">
          <ListChecks data-icon="inline-start" />
          Requirements
        </Button>
        <Button render={<a href="#notes" />} size="sm" variant="ghost">
          Notes
        </Button>
      </nav>
      <EssaysSection detail={detail} />
      <RequirementsSection
        detail={detail}
        patchApplication={patchApplication}
      />
      <section className="scroll-mt-20" id="notes">
        <Collapsible>
          <Card>
            <CardHeader>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
                <CardTitle>Notes</CardTitle>
                <Badge variant="outline">Private workspace note</Badge>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <Textarea
                  aria-label="School notes"
                  onBlur={() => {
                    patchApplication({ notes: notesDraft.value || null });
                    notesDraft.commit();
                  }}
                  onChange={(event) =>
                    notesDraft.setValue(event.currentTarget.value)
                  }
                  placeholder="Add context, questions, or reminders about this application."
                  value={notesDraft.value}
                />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </section>
    </div>
  );
}
