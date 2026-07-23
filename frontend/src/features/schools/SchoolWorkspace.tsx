import {
  ArrowLeft,
  BookOpenText,
  ExternalLink,
  FilePenLine,
  Link2,
  ListChecks,
  Plus,
  RefreshCw,
  Sparkles,
  Unlink,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  useArchiveEssayPromptDraft,
  useConvertEssayPromptDraft,
  useCreateEssay,
  useCreateEssayPromptDraft,
  useCreateTask,
  useArchiveApplication,
  useRestoreApplication,
  useRestoreEssayPromptDraft,
  useUpdateApplication,
  useUpdateEssay,
} from "@/api/workspace/hooks";
import type {
  ApplicationDetail,
  ApplicationPatch,
  ApplicationPlatform,
  ApplicationStatus,
  EssayPromptDraft,
  EssaySummary,
  ListType,
  RequirementApplicability,
  Round,
  SchoolEssayPrompt,
  SchoolPromptGroup,
  SchoolRequirement,
  TaskCategory,
  TestPlan,
  TrackableRequirementKind,
} from "@/api/workspace/types";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UndoToast } from "@/components/undo-toast";
import { PromptDraftRow } from "@/features/essays/PromptDraftRow";
import { SchoolAvatar } from "@/features/schools/school-cells";
import { useUndoableDelete } from "@/hooks/useUndoableDelete";

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
const applicabilityLabels: Record<RequirementApplicability, string> = {
  required: "Required",
  optional: "Optional",
  not_required: "Not required",
  conditional: "Conditional",
  unknown: "Unknown",
};

type CommonRequirement = {
  kind: string;
  label: string;
  category: TaskCategory;
  trackable?: TrackableRequirementKind;
  statuses?: string[];
};

const commonRequirements: CommonRequirement[] = [
  {
    kind: "fee",
    label: "Application fee",
    category: "form",
    trackable: "fee",
    statuses: ["to_do", "waiver_requested", "paid"],
  },
  {
    kind: "testing",
    label: "Testing",
    category: "form",
    trackable: "testing",
    statuses: ["not_started", "in_progress", "submitted"],
  },
  {
    kind: "css_profile",
    label: "CSS Profile",
    category: "aid",
    trackable: "css_profile",
    statuses: ["not_started", "in_progress", "submitted"],
  },
  {
    kind: "fafsa",
    label: "FAFSA",
    category: "aid",
    trackable: "fafsa",
    statuses: ["not_started", "in_progress", "submitted"],
  },
  { kind: "teacher_rec", label: "Teacher recommendations", category: "lor" },
  { kind: "counselor_rec", label: "Counselor recommendation", category: "lor" },
  { kind: "transcript", label: "Transcript", category: "form" },
  { kind: "interview", label: "Interview", category: "interview" },
];

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function useSyncedDraft<TValue>(serverValue: TValue) {
  const [draft, setDraft] = useState({ dirty: false, value: serverValue });
  return {
    dirty: draft.dirty,
    value: draft.dirty ? draft.value : serverValue,
    setValue: (next: TValue) => setDraft({ dirty: true, value: next }),
    commit: () => setDraft((current) => ({ ...current, dirty: false })),
    revert: () => setDraft({ dirty: false, value: serverValue }),
  };
}

function cycleLabel(cycleYear: number | null | undefined) {
  return cycleYear
    ? `${cycleYear - 1}-${String(cycleYear).slice(-2)}`
    : "cycle not confirmed";
}

function referenceDetail(requirement: SchoolRequirement) {
  if (requirement.kind === "fee") {
    const amount = requirement.detail.amount_cents;
    const waiver = requirement.detail.waiver_available;
    const parts = [
      typeof amount === "number" ? `Fee: $${(amount / 100).toFixed(2)}` : null,
      typeof waiver === "boolean"
        ? `Fee waiver: ${waiver ? "available" : "not available"}`
        : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }
  if (
    requirement.kind === "teacher_rec" ||
    requirement.kind === "counselor_rec"
  ) {
    const count = requirement.detail.count;
    if (typeof count === "number")
      return `${count} recommendation${count === 1 ? "" : "s"}`;
  }
  if (requirement.kind === "testing") {
    const policy = requirement.detail.policy;
    if (typeof policy === "string") return humanize(policy);
  }
  const entries = Object.entries(requirement.detail ?? {}).filter(
    ([, value]) => value !== null && value !== "",
  );
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => `${humanize(key)}: ${formatDetailValue(value)}`)
    .join(" · ");
}

function formatDetailValue(value: unknown, depth = 0): string {
  if (value == null) return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (depth >= 2) return "See cited source";
  if (Array.isArray(value))
    return value.map((item) => formatDetailValue(item, depth + 1)).join(", ");
  if (typeof value === "object") {
    return (
      Object.entries(value as Record<string, unknown>)
        .map(
          ([key, nested]) =>
            `${humanize(key)} ${formatDetailValue(nested, depth + 1)}`,
        )
        .join("; ") || "No additional detail"
    );
  }
  return "See cited source";
}

function audienceDescription(audience: Record<string, unknown>) {
  const knownLabels: Record<string, string> = {
    applicant_type: "Applicant type",
    college: "College",
    major: "Major",
    program: "Program",
    residency: "Residency",
  };
  const entries = Object.entries(audience ?? {});
  if (entries.length === 0) return null;
  const readable = entries
    .filter(
      ([key, value]) =>
        key in knownLabels &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"),
    )
    .map(([key, value]) => `${knownLabels[key]}: ${String(value)}`);
  const hasAdditionalConditions = entries.some(
    ([key]) => !(key in knownLabels),
  );
  if (readable.length === 0) {
    return "Published conditions apply; verify the details in the cited source.";
  }
  return `${readable.join(" · ")}${hasAdditionalConditions ? " · Additional published conditions also apply" : ""}`;
}

function Provenance({
  provenance,
}: {
  provenance: { source: string; source_url: string; verified_at: string };
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Verified {provenance.verified_at} from{" "}
      <a
        className="underline underline-offset-3 hover:text-foreground"
        href={provenance.source_url}
        rel="noreferrer"
        target="_blank"
      >
        {provenance.source} <ExternalLink className="inline size-3" />
      </a>
    </p>
  );
}

function FieldSelect<TValue extends string>({
  label,
  onChange,
  options,
  value,
  labels,
}: {
  label: string;
  onChange: (value: TValue) => void;
  options: readonly TValue[];
  value: TValue;
  labels?: Partial<Record<TValue, string>>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Select onValueChange={(next) => onChange(next as TValue)} value={value}>
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {labels?.[option] ?? humanize(option)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </label>
  );
}

function QuickAddTask({
  applicationId,
  category,
  requirementKind,
}: {
  applicationId: string;
  category: TaskCategory;
  requirementKind: string;
}) {
  const [title, setTitle] = useState("");
  const createTask = useCreateTask();
  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    await createTask.mutateAsync({
      application_id: applicationId,
      category,
      requirement_kind: requirementKind,
      title: trimmed,
    });
    setTitle("");
  }
  return (
    <InputGroup>
      <InputGroupAddon>
        <Plus />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={`Add task for ${humanize(requirementKind)}`}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder="Add a task"
        value={title}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          disabled={!title.trim() || createTask.isPending}
          onClick={() => void submit()}
        >
          Add
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

function PromptRow({
  applicationId,
  essay,
  group,
  prompt,
  unlinkedEssays,
}: {
  applicationId: string;
  essay?: EssaySummary;
  group?: SchoolPromptGroup;
  prompt: SchoolEssayPrompt;
  unlinkedEssays: EssaySummary[];
}) {
  const navigate = useNavigate();
  const createEssay = useCreateEssay();
  const updateEssay = useUpdateEssay();
  const [selectedEssay, setSelectedEssay] = useState("");
  const progress = prompt.word_limit
    ? Math.min(essay?.word_count ?? 0, prompt.word_limit)
    : 0;
  async function startWriting() {
    const created = await createEssay.mutateAsync({
      application_id: applicationId,
      essay_type: "Supplement",
      prompt: prompt.prompt,
      prompt_ref: prompt.id,
      status: "Not started",
      title: `Supplement ${prompt.ordinal}`,
      word_limit: prompt.word_limit,
    });
    void navigate(`/app/essays/${created.id}`);
  }
  async function attach() {
    if (!selectedEssay) return;
    await updateEssay.mutateAsync({
      id: selectedEssay,
      patch: { application_id: applicationId, prompt_ref: prompt.id },
    });
    setSelectedEssay("");
  }
  return (
    <div className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Prompt {prompt.ordinal}</Badge>
            <Badge variant="secondary">
              {applicabilityLabels[prompt.applicability]}
            </Badge>
            {group ? (
              <span className="text-xs text-muted-foreground">
                {group.label} · choose {group.choice_min}
              </span>
            ) : null}
          </div>
          <p className="text-sm leading-6">{prompt.prompt}</p>
          {prompt.applicability === "conditional" ? (
            <p className="text-sm text-warning">
              Verify whether this prompt applies to you
              {audienceDescription(prompt.audience)
                ? `: ${audienceDescription(prompt.audience)}`
                : "."}
            </p>
          ) : null}
          <Provenance provenance={prompt.provenance} />
          {group ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Choice-group source
              </span>
              <Provenance provenance={group.provenance} />
            </div>
          ) : null}
        </div>
        {essay ? (
          <div className="flex shrink-0 gap-2">
            <Badge variant="secondary">{essay.status}</Badge>
            <Button
              onClick={() => void navigate(`/app/essays/${essay.id}`)}
              size="sm"
            >
              Open
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`Detach ${essay.title} as a personal copy`}
                  onClick={() =>
                    updateEssay.mutate({
                      id: essay.id,
                      patch: { prompt_ref: null },
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  <Unlink data-icon="inline-start" />
                  Detach as personal copy
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                The current prompt text stays with your essay, but catalog
                updates and source provenance will no longer apply.
              </TooltipContent>
            </Tooltip>
          </div>
        ) : prompt.applicability === "not_required" ? (
          <p className="text-sm text-muted-foreground">
            No draft action because this prompt is published as not required.
          </p>
        ) : (
          <Button
            disabled={createEssay.isPending}
            onClick={() => void startWriting()}
            size="sm"
          >
            <FilePenLine data-icon="inline-start" />
            Start writing
          </Button>
        )}
      </div>
      {essay ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{essay.title}</span>
            <span className="tabular-nums">
              {essay.word_count}
              {prompt.word_limit ? ` / ${prompt.word_limit}` : " words"}
            </span>
          </div>
          {prompt.word_limit ? (
            <Meter
              aria-label={`${essay.title} word progress: ${essay.word_count} of ${prompt.word_limit}`}
              max={prompt.word_limit}
              value={progress}
            >
              <MeterTrack className="h-1.5 rounded-full">
                <MeterIndicator />
              </MeterTrack>
            </Meter>
          ) : null}
        </div>
      ) : prompt.applicability !== "not_required" &&
        unlinkedEssays.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            onValueChange={(value) => value && setSelectedEssay(value)}
            value={selectedEssay}
          >
            <SelectTrigger
              aria-label={`Use existing essay for prompt ${prompt.ordinal}`}
              size="sm"
            >
              <SelectValue placeholder="Use existing essay" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {unlinkedEssays.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
          <Button
            disabled={!selectedEssay || updateEssay.isPending}
            onClick={() => void attach()}
            size="sm"
            variant="outline"
          >
            <Link2 data-icon="inline-start" />
            Attach
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PromptDraftsCard({ detail }: { detail: ApplicationDetail }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [promptText, setPromptText] = useState("");
  const [wordLimitText, setWordLimitText] = useState("");
  const createDraft = useCreateEssayPromptDraft();
  const convertDraft = useConvertEssayPromptDraft();
  const archiveDraft = useArchiveEssayPromptDraft();
  const restoreDraft = useRestoreEssayPromptDraft();
  const draftUndo = useUndoableDelete<EssayPromptDraft>({
    archiveMutation: archiveDraft,
    getLabel: () => "Prompt",
    restoreMutation: restoreDraft,
  });

  async function submit() {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    const wordLimit = wordLimitText.trim()
      ? Number.parseInt(wordLimitText, 10)
      : null;
    await createDraft.mutateAsync({
      application_id: detail.application.id,
      prompt: trimmed,
      word_limit: wordLimit && wordLimit > 0 ? wordLimit : null,
    });
    setPromptText("");
    setWordLimitText("");
  }

  async function startWriting(draft: EssayPromptDraft) {
    const created = await convertDraft.mutateAsync({
      id: draft.id,
      title: `${detail.application.school_name} supplement`,
    });
    void navigate(`/app/essays/${created.id}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts you're tracking</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup className="flex-1">
            <InputGroupInput
              aria-label="Add a prompt you're tracking"
              onChange={(event) => setPromptText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder="Add a prompt you know about — you can turn it into a full essay later"
              value={promptText}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                disabled={!promptText.trim() || createDraft.isPending}
                onClick={() => void submit()}
              >
                Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Input
            aria-label="Word limit (optional)"
            className="sm:w-32"
            min={1}
            onChange={(event) => setWordLimitText(event.currentTarget.value)}
            placeholder="Word limit"
            type="number"
            value={wordLimitText}
          />
        </div>
        {detail.prompt_drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tracked prompts yet. Add one above, or start writing directly
            from a catalog prompt above.
          </p>
        ) : (
          <div className="flex flex-col divide-y">
            {detail.prompt_drafts.map((draft) => (
              <PromptDraftRow
                draft={{
                  ...draft,
                  school_name: detail.application.school_name,
                  school_city: detail.application.school_city,
                  school_state: detail.application.school_state,
                  school_website_url: detail.application.website_url,
                }}
                isConverting={convertDraft.isPending}
                key={draft.id}
                onConvert={() => void startWriting(draft)}
                onDelete={() => draftUndo.archive(draft)}
              />
            ))}
          </div>
        )}
      </CardContent>
      <UndoToast
        onDismiss={draftUndo.clearPending}
        onUndo={draftUndo.undo}
        pending={draftUndo.pending}
        reduceMotion={!!reduceMotion}
      />
    </Card>
  );
}

function EssaysSection({ detail }: { detail: ApplicationDetail }) {
  const navigate = useNavigate();
  const createEssay = useCreateEssay();
  const updateEssay = useUpdateEssay();
  const prompts =
    detail.reference.status === "loaded" ? detail.reference.prompts : [];
  const promptGroups = new Map(
    (detail.reference.status === "loaded"
      ? detail.reference.prompt_groups
      : []
    ).map((group) => [group.id, group]),
  );
  const schoolEssays = detail.essays.filter(
    (essay) => essay.essay_type !== "Personal statement",
  );
  const catalogEssays = schoolEssays.filter((essay) => essay.prompt_ref);
  const addedEssays = schoolEssays.filter((essay) => !essay.prompt_ref);
  const publishedPromptIds = new Set(prompts.map((prompt) => prompt.id));
  const unavailablePromptEssays = catalogEssays.filter(
    (essay) => essay.prompt_ref && !publishedPromptIds.has(essay.prompt_ref),
  );
  const suggestedRequest = `Find the official ${cycleLabel(detail.application.cycle_year)} supplemental essay prompts for ${detail.application.school_name}. Cite each source and clearly mark anything uncertain.`;
  async function copySuggestedRequest() {
    try {
      await navigator.clipboard.writeText(suggestedRequest);
      toast.success("Research request copied");
    } catch {
      toast.error("Could not copy the research request");
    }
  }
  async function addEssay() {
    const created = await createEssay.mutateAsync({
      application_id: detail.application.id,
      essay_type: "Supplement",
      status: "Not started",
      title: `${detail.application.school_name} supplement`,
    });
    void navigate(`/app/essays/${created.id}`);
  }
  return (
    <section className="flex scroll-mt-20 flex-col gap-5" id="essays">
      <div>
        <h2 className="font-heading text-xl font-medium">Essays</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Catalog prompts stay separate from drafts you add yourself.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>School prompts</CardTitle>
        </CardHeader>
        <CardContent>
          {!detail.application.cycle_year ||
          detail.reference.status === "cycle_required" ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpenText />
                </EmptyMedia>
                <EmptyTitle>Confirm the application cycle first</EmptyTitle>
                <EmptyDescription>
                  Catalog facts are never loaded against an unknown cycle.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : prompts.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpenText />
                </EmptyMedia>
                <EmptyTitle>
                  {detail.reference.populated
                    ? "No published essay prompts for this cycle"
                    : `No catalog data for the ${cycleLabel(detail.application.cycle_year)} application cycle`}
                </EmptyTitle>
                <EmptyDescription>
                  {detail.reference.populated
                    ? `The catalog contains other ${detail.application.school_name} facts, but no published essay prompts.`
                    : `We do not have any published ${detail.application.school_name} catalog facts for this cycle.`}{" "}
                  Nothing is inferred or fabricated.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => void addEssay()}>
                  <Plus data-icon="inline-start" />
                  Add an essay
                </Button>
                <Button
                  onClick={() => void copySuggestedRequest()}
                  variant="outline"
                >
                  Copy research request
                </Button>
                <Button render={<Link to="/app/ai" />} variant="outline">
                  <Sparkles data-icon="inline-start" />
                  Open Counselle
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            prompts.map((prompt, index) => (
              <div key={prompt.id}>
                {index > 0 ? <Separator /> : null}
                <PromptRow
                  applicationId={detail.application.id}
                  essay={catalogEssays.find(
                    (essay) => essay.prompt_ref === prompt.id,
                  )}
                  group={
                    prompt.group_id
                      ? promptGroups.get(prompt.group_id)
                      : undefined
                  }
                  prompt={prompt}
                  unlinkedEssays={addedEssays}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <PromptDraftsCard detail={detail} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Added by you</CardTitle>
            <Button
              disabled={createEssay.isPending}
              onClick={() => void addEssay()}
              size="sm"
              variant="outline"
            >
              <Plus data-icon="inline-start" />
              Add essay
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {addedEssays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No unlinked school essays yet.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {addedEssays.map((essay) => (
                <div
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  key={essay.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {essay.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {essay.word_count} words · {essay.status}
                    </p>
                  </div>
                  <Button
                    render={<Link to={`/app/essays/${essay.id}`} />}
                    size="sm"
                    variant="ghost"
                  >
                    Open
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {unavailablePromptEssays.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Historical or unavailable prompts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              These drafts remain linked to prompt records that are no longer in
              the published catalog. Your writing is preserved.
            </p>
            <div className="flex flex-col divide-y">
              {unavailablePromptEssays.map((essay) => (
                <div
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  key={essay.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {essay.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {essay.status} · Prompt unavailable
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      render={<Link to={`/app/essays/${essay.id}`} />}
                      size="sm"
                      variant="outline"
                    >
                      Open
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={`Detach ${essay.title} as a personal copy`}
                          onClick={() =>
                            updateEssay.mutate({
                              id: essay.id,
                              patch: { prompt_ref: null },
                            })
                          }
                          size="sm"
                          variant="ghost"
                        >
                          <Unlink data-icon="inline-start" />
                          Detach as personal copy
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        The current prompt text stays with your essay, but
                        catalog updates and source provenance will no longer
                        apply.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

function RequirementsSection({
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
                    className="rounded-md border px-3 py-2 text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

export function SchoolWorkspace({
  detail,
  onRetry,
}: {
  detail: ApplicationDetail;
  onRetry: () => void;
}) {
  const application = detail.application;
  const updateApplication = useUpdateApplication();
  const archiveApplication = useArchiveApplication();
  const restoreApplication = useRestoreApplication();
  const navigate = useNavigate();
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
  async function archiveSchool() {
    await archiveApplication.mutateAsync(application.id);
    void navigate("/app/schools");
    toast.success(`${application.school_name} archived`, {
      action: {
        label: "Undo",
        onClick: () => restoreApplication.mutate(application.id),
      },
    });
  }
  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-14 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 pt-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/app/schools" />}>
                Schools
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{application.school_name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <SchoolAvatar
                name={application.school_name}
                websiteUrl={application.website_url}
              />
              <div className="min-w-0">
                <h1 className="truncate font-heading text-3xl font-medium tracking-tight">
                  {application.school_name}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[application.school_city, application.school_state]
                    .filter(Boolean)
                    .join(", ")}{" "}
                  · {cycleLabel(application.cycle_year)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                render={<Link to="/app/schools" />}
                size="sm"
                variant="ghost"
              >
                <ArrowLeft data-icon="inline-start" />
                Schools
              </Button>
              <Button onClick={onRetry} size="sm" variant="ghost">
                <RefreshCw data-icon="inline-start" />
                Refresh reference
              </Button>
              {application.website_url ? (
                <Button
                  render={
                    <a
                      href={application.website_url}
                      rel="noreferrer"
                      target="_blank"
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  Website <ExternalLink data-icon="inline-end" />
                </Button>
              ) : null}
              <Button
                disabled={archiveApplication.isPending}
                onClick={() => void archiveSchool()}
                size="sm"
                variant="outline"
              >
                Archive
              </Button>
            </div>
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
          className="sticky top-0 z-10 -mx-2 flex gap-1 overflow-x-auto border-y bg-background/95 px-2 py-2 backdrop-blur"
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
    </section>
  );
}
