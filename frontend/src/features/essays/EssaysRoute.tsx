import { Archive, FileText, Plus, Search } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  useApplications,
  useApplication,
  useArchiveEssay,
  useArchiveEssayPromptDraft,
  useConvertEssayPromptDraft,
  useCreateEssay,
  useCreateEssayPromptDraft,
  useDuplicateEssay,
  useEssayPromptDrafts,
  useEssays,
  useRestoreEssay,
  useRestoreEssayPromptDraft,
  useUpdateEssay,
} from "@/api/workspace/hooks";
import type {
  ApplicationView,
  EssayPromptDraftSummary,
  EssayType,
  RequirementApplicability,
} from "@/api/workspace/types";
import { UndoToast } from "@/components/undo-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workspace/PageHeader";
import { essayFromSummary, type Essay } from "@/domain/essay";
import { UNDO_WINDOW_MS, useUndoableDelete } from "@/hooks/useUndoableDelete";
import { EssayLibraryCard } from "@/features/essays/EssayLibraryCard";
import {
  countEssaysByFilter,
  type EssayFilter,
  filterEssays,
  filterOptions,
} from "@/features/essays/essay-filters";
import type { EssaysPageProps } from "@/features/essays/essays-types";
import { PromptDraftRow } from "@/features/essays/PromptDraftRow";
import { cn } from "@/lib/utils";

const noApplicationValue = "none";
const customPromptValue = "custom";
const unselectedPromptValue = "unselected";
const promptHelpId = "new-essay-prompt-help";
const promptWarningId = "new-essay-prompt-warning";

const applicabilityLabels: Record<RequirementApplicability, string> = {
  required: "Required",
  optional: "Optional",
  not_required: "Not required",
  conditional: "Conditional",
  unknown: "Unknown",
};

const essayTypeOptions: readonly EssayType[] = [
  "Personal statement",
  "Supplement",
  "Scholarship",
  "Optional",
];

function FilterTabLabel({ count, label }: { count: number; label: string }) {
  return (
    <>
      <span>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </>
  );
}

function EssaysSkeleton() {
  return (
    <div
      className={cn(
        "grid gap-4",
        "[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]",
      )}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton
          className="h-80 w-full max-w-xs justify-self-center"
          key={index}
        />
      ))}
    </div>
  );
}

function defaultEssayTitle(type: EssayType, application?: ApplicationView) {
  if (type === "Personal statement") {
    return "Personal statement";
  }
  if (application) {
    return `${application.school_name} ${type.toLowerCase()}`;
  }
  return `Untitled ${type.toLowerCase()}`;
}

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

function describeAudience(audience: Record<string, unknown>) {
  const details = Object.entries(audience)
    .filter(([, value]) =>
      ["boolean", "number", "string"].includes(typeof value),
    )
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`);
  return details.length > 0
    ? details.join(" · ")
    : "Published audience conditions apply; verify them with the school.";
}

const draftPromptValuePrefix = "draft-";
const savePromptHelpId = "new-essay-save-prompt-help";

type DialogMode = "essay" | "prompt";

function NewEssayDialog({
  applications,
  initialType,
  isCreating,
  isConvertingDraftPrompt,
  isSavingPromptDraft,
  onConvertDraftPrompt,
  onCreate,
  onOpenChange,
  onSavePromptDraft,
  open,
}: {
  applications: ApplicationView[];
  initialType: EssayType;
  isCreating: boolean;
  isConvertingDraftPrompt: boolean;
  isSavingPromptDraft: boolean;
  onConvertDraftPrompt: (input: { draftId: string; type: EssayType }) => void;
  onCreate: (input: {
    applicationId: string | null;
    promptOrdinal: number | null;
    promptRef: string | null;
    type: EssayType;
  }) => void;
  onOpenChange: (open: boolean) => void;
  onSavePromptDraft: (input: {
    applicationId: string;
    prompt: string;
    wordLimit: number | null;
  }) => void;
  open: boolean;
}) {
  const [mode, setMode] = useState<DialogMode>("essay");
  const [type, setType] = useState<EssayType>(initialType);
  const [applicationId, setApplicationId] = useState(noApplicationValue);
  const [promptRef, setPromptRef] = useState(unselectedPromptValue);
  const [draftPromptText, setDraftPromptText] = useState("");
  const [draftWordLimitText, setDraftWordLimitText] = useState("");
  const selectedApplicationId =
    applicationId === noApplicationValue ||
    (mode === "essay" && type === "Personal statement")
      ? null
      : applicationId;
  const applicationQuery = useApplication(selectedApplicationId);
  const prompts = applicationQuery.data?.reference.prompts ?? [];
  const promptDrafts = applicationQuery.data?.prompt_drafts ?? [];
  const linkedPromptIds = new Set(
    applicationQuery.data?.essays.flatMap((essay) =>
      essay.prompt_ref ? [essay.prompt_ref] : [],
    ) ?? [],
  );
  const selectedPrompt = prompts.find((prompt) => prompt.id === promptRef);
  const selectedDraftPrompt = promptRef.startsWith(draftPromptValuePrefix)
    ? promptDrafts.find(
        (draft) => `${draftPromptValuePrefix}${draft.id}` === promptRef,
      )
    : undefined;
  const selectedPromptIsAvailable =
    promptRef === customPromptValue ||
    !!selectedDraftPrompt ||
    (!applicationQuery.isError &&
      !!selectedPrompt &&
      !linkedPromptIds.has(selectedPrompt.id) &&
      selectedPrompt.applicability !== "not_required");

  function selectType(value: EssayType | null) {
    if (!value) return;
    const nextType = value;
    setType(nextType);
    if (nextType === "Personal statement") {
      setApplicationId(noApplicationValue);
    }
    setPromptRef(unselectedPromptValue);
  }

  function selectApplication(value: string | null) {
    if (!value) return;
    setApplicationId(value);
    setPromptRef(unselectedPromptValue);
  }

  function selectMode(next: DialogMode) {
    if (next === "prompt" && !selectedApplicationId) return;
    setMode(next);
    setPromptRef(unselectedPromptValue);
  }

  function submit() {
    if (mode === "prompt") {
      if (!selectedApplicationId) return;
      const trimmed = draftPromptText.trim();
      if (!trimmed) return;
      const wordLimit = draftWordLimitText.trim()
        ? Number.parseInt(draftWordLimitText, 10)
        : null;
      onSavePromptDraft({
        applicationId: selectedApplicationId,
        prompt: trimmed,
        wordLimit: wordLimit && wordLimit > 0 ? wordLimit : null,
      });
      return;
    }
    if (selectedDraftPrompt) {
      onConvertDraftPrompt({ draftId: selectedDraftPrompt.id, type });
      return;
    }
    onCreate({
      applicationId:
        type === "Personal statement" || applicationId === noApplicationValue
          ? null
          : applicationId,
      promptOrdinal: selectedPrompt?.ordinal ?? null,
      promptRef:
        type === "Personal statement" ||
        applicationId === noApplicationValue ||
        promptRef === customPromptValue ||
        promptRef === unselectedPromptValue
          ? null
          : promptRef,
      type,
    });
  }

  const submitDisabled =
    mode === "prompt"
      ? isSavingPromptDraft ||
        !selectedApplicationId ||
        !draftPromptText.trim()
      : isCreating ||
        isConvertingDraftPrompt ||
        (!!selectedApplicationId &&
          (applicationQuery.isFetching ||
            promptRef === unselectedPromptValue ||
            !selectedPromptIsAvailable));

  return (
    <Dialog modal={false} onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New essay</DialogTitle>
          <DialogDescription>
            Choose the essay type and link a school when this draft belongs to a
            specific application, or save just the prompt for later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <div className="flex gap-2">
            <Button
              onClick={() => selectMode("essay")}
              size="sm"
              type="button"
              variant={mode === "essay" ? "default" : "outline"}
            >
              Write essay now
            </Button>
            <Button
              aria-describedby={
                selectedApplicationId ? undefined : savePromptHelpId
              }
              disabled={!selectedApplicationId}
              onClick={() => selectMode("prompt")}
              size="sm"
              type="button"
              variant={mode === "prompt" ? "default" : "outline"}
            >
              Save prompt for now
            </Button>
          </div>
          {!selectedApplicationId ? (
            <span
              className="text-xs text-muted-foreground"
              id={savePromptHelpId}
            >
              Select a school first — draft prompts always belong to one
              application.
            </span>
          ) : null}
        </div>

        <div className="grid gap-4">
          {mode === "essay" ? (
            <label className="grid gap-2 text-sm font-medium">
              Essay type
              <Select onValueChange={selectType} value={type}>
                <SelectTrigger aria-label="Essay type">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectGroup>
                    {essayTypeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectPopup>
              </Select>
            </label>
          ) : null}

          <label className="grid gap-2 text-sm font-medium">
            School link
            <Select
              disabled={mode === "essay" && type === "Personal statement"}
              onValueChange={selectApplication}
              value={
                mode === "essay" && type === "Personal statement"
                  ? noApplicationValue
                  : applicationId
              }
            >
              <SelectTrigger aria-label="School link">
                <SelectValue placeholder="No school link" />
              </SelectTrigger>
              <SelectPopup>
                <SelectGroup>
                  <SelectItem value={noApplicationValue}>
                    No school link
                  </SelectItem>
                  {applications.map((application) => (
                    <SelectItem key={application.id} value={application.id}>
                      {application.school_name} ·{" "}
                      {application.cycle_year
                        ? `${application.cycle_year - 1}-${String(application.cycle_year).slice(-2)}`
                        : "Cycle unconfirmed"}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectPopup>
            </Select>
          </label>

          {mode === "prompt" ? (
            selectedApplicationId ? (
              <>
                <label className="grid gap-2 text-sm font-medium">
                  Prompt
                  <Textarea
                    aria-label="Prompt text"
                    onChange={(event) =>
                      setDraftPromptText(event.currentTarget.value)
                    }
                    placeholder="Add a prompt you know about — you can turn it into a full essay later"
                    value={draftPromptText}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Word limit (optional)
                  <Input
                    aria-label="Word limit"
                    min={1}
                    onChange={(event) =>
                      setDraftWordLimitText(event.currentTarget.value)
                    }
                    type="number"
                    value={draftWordLimitText}
                  />
                </label>
              </>
            ) : null
          ) : selectedApplicationId ? (
            <label className="grid gap-2 text-sm font-medium">
              Essay prompt
              <Select
                disabled={applicationQuery.isFetching}
                onValueChange={(value) => value && setPromptRef(value)}
                value={promptRef}
              >
                <SelectTrigger
                  aria-describedby={`${promptHelpId}${selectedPrompt?.applicability === "conditional" || selectedPrompt?.applicability === "unknown" ? ` ${promptWarningId}` : ""}`}
                  aria-label="Essay prompt"
                >
                  <SelectValue placeholder="Select a prompt" />
                </SelectTrigger>
                <SelectPopup>
                  <SelectGroup>
                    <SelectItem disabled value={unselectedPromptValue}>
                      Select a published or custom prompt
                    </SelectItem>
                    <SelectItem value={customPromptValue}>
                      Custom essay (no catalog prompt)
                    </SelectItem>
                    {promptDrafts.map((draft) => (
                      <SelectItem
                        key={draft.id}
                        value={`${draftPromptValuePrefix}${draft.id}`}
                      >
                        Tracked prompt: {draft.prompt}
                      </SelectItem>
                    ))}
                    {prompts.map((prompt) => {
                      const alreadyLinked = linkedPromptIds.has(prompt.id);
                      const unavailable =
                        applicationQuery.isError ||
                        alreadyLinked ||
                        prompt.applicability === "not_required";
                      const availability = alreadyLinked
                        ? " · already linked"
                        : prompt.applicability === "not_required"
                          ? " · not required"
                          : "";
                      const wordLimit = prompt.word_limit
                        ? ` · ${prompt.word_limit} words`
                        : "";
                      return (
                        <SelectItem
                          disabled={unavailable}
                          key={prompt.id}
                          value={prompt.id}
                        >
                          Prompt {prompt.ordinal}
                          {` · ${applicabilityLabels[prompt.applicability]}`}
                          {wordLimit}
                          {availability}: {prompt.prompt}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectPopup>
              </Select>
              <span
                aria-live="polite"
                className="text-xs font-normal text-muted-foreground"
                id={promptHelpId}
                role="status"
              >
                {applicationQuery.isLoading
                  ? "Loading published prompts…"
                  : applicationQuery.isError
                    ? "Published prompts could not be loaded. You can still create a custom essay."
                    : applicationQuery.data?.reference.status ===
                        "cycle_required"
                      ? "Confirm this school's application cycle to load its published prompts."
                      : prompts.length === 0
                        ? "No published prompts are available for this school and cycle."
                        : "Selecting a published prompt keeps this essay connected to its catalog wording and word limit."}
              </span>
              {selectedPrompt ? (
                <span className="text-xs font-normal text-muted-foreground">
                  Source: {selectedPrompt.provenance.source} · verified{" "}
                  {selectedPrompt.provenance.verified_at}
                </span>
              ) : null}
              {selectedPrompt?.applicability === "conditional" ? (
                <span
                  aria-live="polite"
                  className="text-xs font-normal text-warning"
                  id={promptWarningId}
                  role="status"
                >
                  This prompt is conditional. Verify whether it applies to you:{" "}
                  {describeAudience(selectedPrompt.audience)}
                </span>
              ) : selectedPrompt?.applicability === "unknown" ? (
                <span
                  aria-live="polite"
                  className="text-xs font-normal text-warning"
                  id={promptWarningId}
                  role="status"
                >
                  The school has not confirmed who must answer this prompt.
                  Verify before relying on it.
                </span>
              ) : null}
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button disabled={submitDisabled} onClick={submit} type="button">
            <Plus aria-hidden="true" data-icon="inline-start" />
            {mode === "prompt" ? "Save prompt" : "Create essay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EssaysPage({ onOpenEssay }: EssaysPageProps = {}) {
  const essaysQuery = useEssays();
  const applicationsQuery = useApplications();
  const promptDraftsQuery = useEssayPromptDrafts();
  const createEssayMutation = useCreateEssay();
  const duplicateEssayMutation = useDuplicateEssay();
  const updateEssayMutation = useUpdateEssay();
  const archiveEssayMutation = useArchiveEssay();
  const restoreEssayMutation = useRestoreEssay();
  const createPromptDraftMutation = useCreateEssayPromptDraft();
  const convertPromptDraftMutation = useConvertEssayPromptDraft();
  const archivePromptDraftMutation = useArchiveEssayPromptDraft();
  const restorePromptDraftMutation = useRestoreEssayPromptDraft();
  const promptDraftUndo = useUndoableDelete<EssayPromptDraftSummary>({
    archiveMutation: archivePromptDraftMutation,
    getLabel: () => "Prompt",
    restoreMutation: restorePromptDraftMutation,
  });
  const reduceMotion = useReducedMotion();

  const [createOpen, setCreateOpen] = useState(false);
  const [initialCreateType, setInitialCreateType] =
    useState<EssayType>("Supplement");
  const [filter, setFilter] = useState<EssayFilter>("all");
  const [pendingArchiveUndo, setPendingArchiveUndo] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const archiveUndoTimeoutRef = useRef<number | undefined>(undefined);

  const essays = useMemo(
    () => listOrEmpty(essaysQuery.data).map(essayFromSummary),
    [essaysQuery.data],
  );
  const applications = listOrEmpty(applicationsQuery.data);
  const filteredEssays = useMemo(
    () => filterEssays(essays, filter, query),
    [essays, filter, query],
  );
  const promptDraftsBySchool = useMemo(() => {
    const groups = new Map<
      string,
      { schoolName: string; drafts: EssayPromptDraftSummary[] }
    >();
    for (const draft of listOrEmpty(promptDraftsQuery.data)) {
      const existing = groups.get(draft.application_id);
      if (existing) {
        existing.drafts.push(draft);
      } else {
        groups.set(draft.application_id, {
          drafts: [draft],
          schoolName: draft.school_name,
        });
      }
    }
    return [...groups.values()];
  }, [promptDraftsQuery.data]);
  const clearArchiveUndo = useCallback(() => {
    window.clearTimeout(archiveUndoTimeoutRef.current);
    setPendingArchiveUndo(null);
  }, []);

  const showArchiveUndo = useCallback(
    (essay: Essay) => {
      window.clearTimeout(archiveUndoTimeoutRef.current);
      setPendingArchiveUndo({ id: essay.id, label: essay.title });
      archiveUndoTimeoutRef.current = window.setTimeout(
        clearArchiveUndo,
        UNDO_WINDOW_MS,
      );
    },
    [clearArchiveUndo],
  );

  useEffect(() => clearArchiveUndo, [clearArchiveUndo]);

  function openCreateDialog(type: EssayType = "Supplement") {
    setInitialCreateType(type);
    setCreateOpen(true);
  }

  async function createEssay(input: {
    applicationId: string | null;
    promptOrdinal: number | null;
    promptRef: string | null;
    type: EssayType;
  }) {
    const application = applications.find(
      (item) => item.id === input.applicationId,
    );
    try {
      const created = await createEssayMutation.mutateAsync({
        application_id: input.applicationId,
        essay_type: input.type,
        prompt_ref: input.promptRef,
        status: "Not started",
        title:
          application && input.promptOrdinal
            ? `${application.school_name} ${input.type.toLowerCase()} ${input.promptOrdinal}`
            : defaultEssayTitle(input.type, application),
      });
      setCreateOpen(false);
      onOpenEssay?.(essayFromSummary(created));
    } catch {
      // Mutation hooks own optimistic rollback and error toast behavior.
    }
  }

  async function duplicateEssay(essay: Essay) {
    try {
      const duplicated = await duplicateEssayMutation.mutateAsync(essay.id);
      onOpenEssay?.(essayFromSummary(duplicated));
    } catch {
      // Mutation hook owns error toast behavior.
    }
  }

  function markReady(essay: Essay) {
    updateEssayMutation.mutate({
      id: essay.id,
      patch: { status: "Ready" },
    });
  }

  async function archiveEssay(essay: Essay) {
    try {
      await archiveEssayMutation.mutateAsync(essay.id);
      showArchiveUndo(essay);
    } catch {
      // Mutation hook owns optimistic rollback and error toast behavior.
    }
  }

  function undoArchiveEssay() {
    if (!pendingArchiveUndo) {
      return;
    }

    restoreEssayMutation.mutate(pendingArchiveUndo.id);
    clearArchiveUndo();
  }

  async function savePromptDraft(input: {
    applicationId: string;
    prompt: string;
    wordLimit: number | null;
  }) {
    try {
      await createPromptDraftMutation.mutateAsync({
        application_id: input.applicationId,
        prompt: input.prompt,
        word_limit: input.wordLimit,
      });
      setCreateOpen(false);
      toast.success("Prompt saved");
    } catch {
      // Mutation hook owns optimistic rollback and error toast behavior.
    }
  }

  async function convertDraftPrompt(input: {
    draftId: string;
    type: EssayType;
  }) {
    const draft = listOrEmpty(promptDraftsQuery.data).find(
      (item) => item.id === input.draftId,
    );
    try {
      const created = await convertPromptDraftMutation.mutateAsync({
        essayType: input.type,
        id: input.draftId,
        title: draft
          ? `${draft.school_name} ${input.type.toLowerCase()}`
          : defaultEssayTitle(input.type),
      });
      setCreateOpen(false);
      onOpenEssay?.(essayFromSummary(created));
    } catch {
      // Mutation hook owns optimistic rollback and error toast behavior.
    }
  }

  const hasNoEssays =
    !essaysQuery.isLoading && !essaysQuery.isError && essays.length === 0;

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
        <PageHeader
          actions={
            <Button
              onClick={() => openCreateDialog()}
              type="button"
              variant="outline"
            >
              <Plus aria-hidden="true" data-icon="inline-start" />
              New essay
            </Button>
          }
          title="Essay workspace"
        />

        {!promptDraftsQuery.isLoading &&
        !promptDraftsQuery.isError &&
        promptDraftsBySchool.length > 0 ? (
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-heading text-sm font-medium">
              Prompts you're tracking
            </h2>
            <div className="mt-2 flex flex-col divide-y">
              {promptDraftsBySchool.map((group) => (
                <div
                  className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"
                  key={group.drafts[0]?.application_id}
                >
                  {group.drafts.map((draft) => (
                    <PromptDraftRow
                      draft={draft}
                      isConverting={convertPromptDraftMutation.isPending}
                      key={draft.id}
                      onConvert={() =>
                        void convertDraftPrompt({
                          draftId: draft.id,
                          type: "Supplement",
                        })
                      }
                      onDelete={() => promptDraftUndo.archive(draft)}
                      showSchool
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {essaysQuery.isLoading ? (
          <EssaysSkeleton />
        ) : essaysQuery.isError ? (
          <div className="rounded-xl border bg-card p-6">
            <div className="max-w-md space-y-3">
              <h2 className="font-heading text-lg font-medium">
                Could not load essays
              </h2>
              <p className="text-sm text-muted-foreground">
                The workspace could not reach your essay library.
              </p>
              <Button onClick={() => void essaysQuery.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : hasNoEssays ? (
          <Empty className="rounded-xl border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No essays yet</EmptyTitle>
              <EmptyDescription>
                Start your personal statement or create a school-linked draft
                when you add applications.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => openCreateDialog("Personal statement")}>
                <Plus data-icon="inline-start" />
                Start personal statement
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <Tabs
                aria-label="Essay filters"
                className="min-w-0"
                onValueChange={(value) => setFilter(value as EssayFilter)}
                value={filter}
              >
                <TabsList className="w-full flex-wrap justify-start gap-y-1 sm:w-fit">
                  {filterOptions.map((option) => (
                    <TabsTab
                      className="sm:h-7 sm:px-2 sm:text-xs"
                      key={option.value}
                      value={option.value}
                    >
                      <FilterTabLabel
                        count={countEssaysByFilter(essays, option.value)}
                        label={option.label}
                      />
                    </TabsTab>
                  ))}
                </TabsList>
              </Tabs>

              <div className="relative w-full min-w-0 sm:w-72">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-muted)]"
                />
                <Input
                  aria-label="Search essays"
                  className="[&_[data-slot=input]]:pl-9"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search essays"
                  type="search"
                  value={query}
                />
              </div>
            </div>

            {filteredEssays.length > 0 ? (
              <div
                className={cn(
                  "grid gap-4",
                  "[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]",
                )}
              >
                {filteredEssays.map((essay) => (
                  <EssayLibraryCard
                    essay={essay}
                    key={essay.id}
                    onArchiveEssay={(item) => void archiveEssay(item)}
                    onDuplicateEssay={(item) => void duplicateEssay(item)}
                    onMarkReady={markReady}
                    onOpenEssay={onOpenEssay}
                  />
                ))}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Archive aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No essays found</EmptyTitle>
                  <EmptyDescription>
                    Adjust the filter or search query to return to the essay
                    list.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                    type="button"
                    variant="outline"
                  >
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </>
        )}
      </div>

      {createOpen ? (
        <NewEssayDialog
          applications={applications}
          initialType={initialCreateType}
          isConvertingDraftPrompt={convertPromptDraftMutation.isPending}
          isCreating={createEssayMutation.isPending}
          isSavingPromptDraft={createPromptDraftMutation.isPending}
          onConvertDraftPrompt={(input) => void convertDraftPrompt(input)}
          onCreate={(input) => void createEssay(input)}
          onOpenChange={setCreateOpen}
          onSavePromptDraft={(input) => void savePromptDraft(input)}
          open={createOpen}
        />
      ) : null}
      <UndoToast
        onDismiss={clearArchiveUndo}
        onUndo={undoArchiveEssay}
        pending={
          pendingArchiveUndo ? { label: pendingArchiveUndo.label } : null
        }
        reduceMotion={!!reduceMotion}
      />
      <UndoToast
        onDismiss={promptDraftUndo.clearPending}
        onUndo={promptDraftUndo.undo}
        pending={promptDraftUndo.pending}
        reduceMotion={!!reduceMotion}
      />
    </section>
  );
}
