import { ExternalLink, FilePenLine, RefreshCw } from "lucide-react";

import { useUpdateApplication } from "@/api/workspace/hooks";
import type {
  ApplicationDetail,
  ApplicationPatch,
  ApplicationStatus,
  DeadlineSource,
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
import { FieldSelect } from "@/features/schools/school-workspace-fields";
import {
  cycleLabel,
  deadlineSourceLabel,
} from "@/features/schools/school-workspace-format";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";

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

function DeadlineField({
  label,
  draft,
  source,
  checkedAt,
  inheritedDate,
  onCommit,
  onUseInherited,
}: {
  label: string;
  draft: ReturnType<typeof useSyncedDraft<string>>;
  source: DeadlineSource | null;
  checkedAt: string | null;
  inheritedDate: string | null;
  onCommit: (value: string | null) => void;
  onUseInherited: () => void;
}) {
  const canUseInherited =
    source === "student" && inheritedDate !== null && inheritedDate !== draft.value;
  return (
    <div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      <label className="flex flex-col gap-1.5">
        {label}
        <Input
          nativeInput
          onBlur={() => {
            if (!draft.dirty) return;
            onCommit(draft.value || null);
            draft.commit();
          }}
          onChange={(event) => draft.setValue(event.currentTarget.value)}
          type="date"
          value={draft.value}
        />
      </label>
      {source === "facts" && checkedAt ? (
        <span className="text-xs font-normal text-muted-foreground">
          {deadlineSourceLabel(source, checkedAt)}
        </span>
      ) : null}
      {canUseInherited ? (
        <Button
          className="h-auto self-start px-0"
          onClick={onUseInherited}
          size="xs"
          type="button"
          variant="link"
        >
          Use Counselle&rsquo;s date
        </Button>
      ) : null}
    </div>
  );
}

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
  const aidDeadlineDraft = useSyncedDraft(application.aid_deadline ?? "");
  const notesDraft = useSyncedDraft(application.notes ?? "");
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <DeadlineField
            checkedAt={application.deadline_checked_at}
            draft={deadlineDraft}
            inheritedDate={application.deadline_inherited_date}
            label="Application deadline"
            onCommit={(deadline) => patchApplication({ deadline })}
            onUseInherited={() => patchApplication({ deadline: null })}
            source={application.deadline_source}
          />
          <DeadlineField
            checkedAt={application.aid_deadline_checked_at}
            draft={aidDeadlineDraft}
            inheritedDate={application.aid_deadline_inherited_date}
            label="Aid deadline"
            onCommit={(aid_deadline) => patchApplication({ aid_deadline })}
            onUseInherited={() => patchApplication({ aid_deadline: null })}
            source={application.aid_deadline_source}
          />
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
        <Button render={<a href="#notes" />} size="sm" variant="ghost">
          Notes
        </Button>
      </nav>
      <EssaysSection detail={detail} />
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
