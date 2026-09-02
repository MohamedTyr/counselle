import { GraduationCap, Plus } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";

import type { ApplicationView, EssayType } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/components/ui/segmented-control";
import {
  EssayPromptComposer,
  isWordLimitInvalid,
  parseWordLimit,
} from "@/features/essays/EssayPromptComposer";
import { PERSONAL_STATEMENT_PROMPTS } from "@/features/essays/personal-statement-prompts";
import { AddSchoolDialog } from "@/features/schools/AddSchoolDialog";
import { cn } from "@/lib/utils";

export type NewEssayCreateInput = {
  applicationId: string | null;
  prompt: string | null;
  type: EssayType;
  wordLimit: number | null;
};

type EssayBranch = "Personal statement" | "Supplement";

const branchOptions: readonly SegmentedControlOption<EssayBranch>[] = [
  { label: "Personal statement", value: "Personal statement" },
  { label: "Supplement", value: "Supplement" },
];

/** Not a real prompt id — "no prompt chosen yet" is a first-class choice. */
const NO_PROMPT_VALUE = "no-prompt-yet";

function branchFromType(type: EssayType): EssayBranch {
  return type === "Personal statement" ? "Personal statement" : "Supplement";
}

/*
 * Copied from ClarifyOptionRow's radio + multi-line-label composition
 * (features/ai-chat/components/clarify/ClarifyQuestion.tsx:227-267) rather
 * than imported — that component isn't exported. Same pattern, not a
 * second one (DESIGN.md rule 21).
 */
function PromptOptionRow({
  control,
  hint,
  htmlFor,
  label,
  selected,
}: {
  control: React.ReactNode;
  hint?: string;
  htmlFor: string;
  label: string;
  selected: boolean;
}) {
  return (
    <label
      className={cn(
        "group flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent",
        selected &&
          "border-[var(--workspace-border)] bg-[var(--workspace-surface-active)]",
      )}
      htmlFor={htmlFor}
    >
      <span className="mt-0.5">{control}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-sm leading-snug font-medium text-foreground",
            selected && "font-semibold",
          )}
        >
          {label}
        </span>
        {hint ? (
          <span className="text-xs leading-relaxed text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Full prompt text visible for every option (a student has to *read* seven
 * ~50-word prompts to choose, not scroll through a dropdown), capped in a
 * ScrollArea so the dialog never outgrows the viewport. The eighth option —
 * "I haven't chosen a prompt yet" — is the default selection, so this
 * branch always opens in a valid, submittable state (plan §3.2).
 *
 * `autoFocus` on the checked item, not the first item: Radix RadioGroup
 * uses roving tabindex, so the checked item is the only one that's
 * naturally tabbable. It also doubles as "move focus to the new branch's
 * first control on swap" — this subtree only mounts when the branch is (or
 * becomes) "Personal statement", so autoFocus fires exactly then.
 */
function PersonalStatementBranch({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string) => void;
  selectedId: string;
}) {
  const headingId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" id={headingId}>
        Choose a prompt
      </span>
      <ScrollArea
        className="max-h-[22rem] rounded-lg bg-[var(--surface-inset)]"
        scrollFade
      >
        <RadioGroup
          aria-labelledby={headingId}
          className="gap-2 p-2"
          onValueChange={onSelect}
          value={selectedId}
        >
          <PersonalStatementPromptOptions
            headingId={headingId}
            selectedId={selectedId}
          />
        </RadioGroup>
      </ScrollArea>
    </div>
  );
}

/** The seven Common App prompts plus the "no prompt yet" opt-out, split out
 * of `PersonalStatementBranch` to keep that function under the file's
 * function-length budget (AGENTS.md). */
function PersonalStatementPromptOptions({
  headingId,
  selectedId,
}: {
  headingId: string;
  selectedId: string;
}) {
  return (
    <>
      {PERSONAL_STATEMENT_PROMPTS.map((prompt) => (
        <PromptOptionRow
          control={
            <RadioGroupItem
              autoFocus={selectedId === prompt.id}
              id={`${headingId}-${prompt.id}`}
              value={prompt.id}
            />
          }
          hint={prompt.text}
          htmlFor={`${headingId}-${prompt.id}`}
          key={prompt.id}
          label={`Prompt ${prompt.ordinal}`}
          selected={selectedId === prompt.id}
        />
      ))}
      <PromptOptionRow
        control={
          <RadioGroupItem
            autoFocus={selectedId === NO_PROMPT_VALUE}
            id={`${headingId}-${NO_PROMPT_VALUE}`}
            value={NO_PROMPT_VALUE}
          />
        }
        htmlFor={`${headingId}-${NO_PROMPT_VALUE}`}
        label="I haven't chosen a prompt yet"
        selected={selectedId === NO_PROMPT_VALUE}
      />
    </>
  );
}

function SelectedSchoolRow({
  application,
  onChange,
}: {
  application: ApplicationView;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--control-track)] px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {application.school_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {application.list_type}
        </p>
      </div>
      <Button
        autoFocus
        onClick={onChange}
        size="sm"
        type="button"
        variant="ghost"
      >
        Change
      </Button>
    </div>
  );
}

/** §13.2 empty state, inline inside the field rather than gating the whole
 * segment — rule 34: an absent value renders as words, not a disabled
 * control with no explanation. */
function SchoolFieldEmptyState({ onAddSchool }: { onAddSchool: () => void }) {
  return (
    <Empty className="rounded-lg border bg-card py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GraduationCap aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-base">No schools yet</EmptyTitle>
        <EmptyDescription>
          A supplement links to one of the schools on your list.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button autoFocus onClick={onAddSchool} size="sm" type="button">
          <Plus data-icon="inline-start" />
          Add school
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Renders one of three states — no schools yet, a school already chosen, or
 * the search list — and each one mounts a different first control:
 * `SchoolFieldEmptyState`'s "Add school" button, `SelectedSchoolRow`'s
 * "Change" button, or `SchoolSearchCommand`'s input. Every one of those
 * controls carries its own `autoFocus`, so this field always moves focus to
 * its current first control on mount — whether that's the initial render of
 * the "Supplement" branch or a state change within it (e.g. picking a school
 * and then clicking "Change" again) — instead of leaving focus orphaned on a
 * control that just left the DOM.
 */
function SupplementSchoolField({
  applications,
  onAddSchool,
  onSelectApplication,
  selectedApplicationId,
}: {
  applications: ApplicationView[];
  onAddSchool: () => void;
  onSelectApplication: (id: string | null) => void;
  selectedApplicationId: string | null;
}) {
  if (applications.length === 0) {
    return <SchoolFieldEmptyState onAddSchool={onAddSchool} />;
  }

  if (selectedApplicationId) {
    return (
      <SelectedApplicationField
        applications={applications}
        onChange={() => onSelectApplication(null)}
        selectedApplicationId={selectedApplicationId}
      />
    );
  }

  return (
    <SchoolSearchCommand
      applications={applications}
      onSelectApplication={onSelectApplication}
    />
  );
}

/** The already-picked row, or (if the optimistic school id from
 * `AddSchoolDialog` hasn't landed in `applications` yet) a transient
 * placeholder — split out of `SupplementSchoolField` for the function-
 * length budget. */
function SelectedApplicationField({
  applications,
  onChange,
  selectedApplicationId,
}: {
  applications: ApplicationView[];
  onChange: () => void;
  selectedApplicationId: string;
}) {
  const selected = applications.find(
    (application) => application.id === selectedApplicationId,
  );
  return selected ? (
    <SelectedSchoolRow application={selected} onChange={onChange} />
  ) : (
    <p className="rounded-lg bg-[var(--control-track)] px-3 py-2 text-sm text-muted-foreground">
      Adding your school…
    </p>
  );
}

/**
 * Same Command/CommandInput/CommandList composition AddSchoolDialog.tsx
 * (307-379) uses, scoped to the student's own application list instead of
 * the school-catalog search — a supplement links to an application row
 * that must already exist. `autoFocus` on the input is this state's first
 * control, per the doc comment on `SupplementSchoolField`.
 */
function SchoolSearchCommand({
  applications,
  onSelectApplication,
}: {
  applications: ApplicationView[];
  onSelectApplication: (id: string | null) => void;
}) {
  return (
    <Command aria-label="School">
      <CommandInput autoFocus placeholder="Search your schools…" />
      <CommandList>
        <CommandEmpty>No schools match.</CommandEmpty>
        <CommandGroup>
          {applications.map((application) => (
            <CommandItem
              key={application.id}
              onSelect={() => onSelectApplication(application.id)}
              value={application.school_name}
            >
              <span className="min-w-0 flex-1 truncate">
                {application.school_name}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {application.list_type}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function SupplementBranch({
  applications,
  onAddSchool,
  onPromptChange,
  onSelectApplication,
  onWordLimitChange,
  prompt,
  selectedApplicationId,
  wordLimit,
}: {
  applications: ApplicationView[];
  onAddSchool: () => void;
  onPromptChange: (value: string) => void;
  onSelectApplication: (id: string | null) => void;
  onWordLimitChange: (value: string) => void;
  prompt: string;
  selectedApplicationId: string | null;
  wordLimit: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">School</span>
        <SupplementSchoolField
          applications={applications}
          onAddSchool={onAddSchool}
          onSelectApplication={onSelectApplication}
          selectedApplicationId={selectedApplicationId}
        />
      </div>
      <EssayPromptComposer
        onPromptChange={onPromptChange}
        onWordLimitChange={onWordLimitChange}
        prompt={prompt}
        wordLimit={wordLimit}
      />
    </div>
  );
}

/** Pure so it's easy to reason about and keeps `useNewEssayDialogState`
 * under the function-length budget. */
function buildCreateInput({
  branch,
  personalStatementPromptId,
  selectedApplicationId,
  supplementPrompt,
  supplementWordLimitText,
}: {
  branch: EssayBranch;
  personalStatementPromptId: string;
  selectedApplicationId: string | null;
  supplementPrompt: string;
  supplementWordLimitText: string;
}): NewEssayCreateInput {
  if (branch === "Personal statement") {
    const selectedPrompt = PERSONAL_STATEMENT_PROMPTS.find(
      (prompt) => prompt.id === personalStatementPromptId,
    );
    return {
      applicationId: null,
      prompt: selectedPrompt?.text ?? null,
      type: "Personal statement",
      // Word limit intentionally omitted — see
      // personal-statement-prompts.ts for why it isn't verified.
      wordLimit: null,
    };
  }
  return {
    applicationId: selectedApplicationId,
    prompt: supplementPrompt.trim() || null,
    type: "Supplement",
    wordLimit: parseWordLimit(supplementWordLimitText),
  };
}

function useNewEssayDialogState({
  applications,
  initialType,
  isCreating,
}: {
  applications: ApplicationView[];
  initialType: EssayType;
  isCreating: boolean;
}) {
  const [branch, setBranch] = useState<EssayBranch>(() =>
    branchFromType(initialType),
  );
  const [personalStatementPromptId, setPersonalStatementPromptId] =
    useState(NO_PROMPT_VALUE);
  const [selectedApplicationId, setSelectedApplicationId] = useState<
    string | null
  >(null);
  const [supplementPrompt, setSupplementPrompt] = useState("");
  const [supplementWordLimitText, setSupplementWordLimitText] = useState("");
  const [addSchoolOpen, setAddSchoolOpen] = useState(false);

  const supplementBlocked =
    branch === "Supplement" &&
    (!selectedApplicationId || isWordLimitInvalid(supplementWordLimitText));
  const submitDisabled = isCreating || supplementBlocked;
  const disabledReason =
    branch === "Supplement" &&
    applications.length > 0 &&
    !selectedApplicationId
      ? "Select a school to create this essay."
      : "";

  return {
    addSchoolOpen,
    branch,
    disabledReason,
    personalStatementPromptId,
    selectedApplicationId,
    setAddSchoolOpen,
    setBranch,
    setPersonalStatementPromptId,
    setSelectedApplicationId,
    setSupplementPrompt,
    setSupplementWordLimitText,
    submitDisabled,
    supplementPrompt,
    supplementWordLimitText,
  };
}

type NewEssayDialogState = ReturnType<typeof useNewEssayDialogState>;

function NewEssayDialogHeader() {
  return (
    <DialogHeader>
      <DialogTitle>New essay</DialogTitle>
      <DialogDescription>
        Pick the kind of essay you're starting. You can change any of this
        later.
      </DialogDescription>
    </DialogHeader>
  );
}

/** Deliberately no transition on branch swap — the segmented thumb already
 * carries the state change, and a crossfade on every toggle of a binary
 * control is decoration, not state (DESIGN.md §12.1). Don't add one back. */
function NewEssayDialogBranch({
  applications,
  state,
}: {
  applications: ApplicationView[];
  state: NewEssayDialogState;
}) {
  if (state.branch === "Personal statement") {
    return (
      <PersonalStatementBranch
        onSelect={state.setPersonalStatementPromptId}
        selectedId={state.personalStatementPromptId}
      />
    );
  }
  return (
    <SupplementBranch
      applications={applications}
      onAddSchool={() => state.setAddSchoolOpen(true)}
      onPromptChange={state.setSupplementPrompt}
      onSelectApplication={state.setSelectedApplicationId}
      onWordLimitChange={state.setSupplementWordLimitText}
      prompt={state.supplementPrompt}
      selectedApplicationId={state.selectedApplicationId}
      wordLimit={state.supplementWordLimitText}
    />
  );
}

function NewEssayDialogFooter({
  disabledReason,
  isCreating,
  onCancel,
  onSubmit,
  statusId,
  submitDisabled,
}: {
  disabledReason: string;
  isCreating: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  statusId: string;
  submitDisabled: boolean;
}) {
  return (
    <DialogFooter>
      <Button onClick={onCancel} type="button" variant="outline">
        Cancel
      </Button>
      <Button
        aria-describedby={disabledReason ? statusId : undefined}
        disabled={submitDisabled}
        onClick={onSubmit}
        type="button"
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        {isCreating ? "Creating…" : "Create essay"}
      </Button>
    </DialogFooter>
  );
}

/** The dialog's header, branch selector, active branch, and footer —
 * split into `NewEssayDialogHeader`/`NewEssayDialogBranch`/
 * `NewEssayDialogFooter` for the file's function-length budget.
 *
 * The header and footer are plain flex children (natural height, never
 * scroll); only the segmented control + active branch scroll, in their own
 * `overflow-y-auto` region — see the `DialogContent` className in
 * `NewEssayDialog` for the matching `flex flex-col` + `max-h`. The personal-
 * statement branch's own `ScrollArea` (max-h-[22rem]) nests inside that
 * region: on a short viewport the prompt list scrolls internally first
 * (it's almost always taller than 22rem on its own), and this outer region
 * only needs to move the segmented control out of the way — the header and
 * `[Create essay]` stay pinned throughout, never the two competing for the
 * same scroll gesture. */
function NewEssayDialogFields({
  applications,
  isCreating,
  onCancel,
  onSubmit,
  state,
}: {
  applications: ApplicationView[];
  isCreating: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  state: NewEssayDialogState;
}) {
  const statusId = useId();

  return (
    <>
      <NewEssayDialogHeader />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <SegmentedControl
          label="Essay type"
          onValueChange={state.setBranch}
          options={branchOptions}
          value={state.branch}
        />
        <NewEssayDialogBranch applications={applications} state={state} />
        <span
          aria-live="polite"
          className="sr-only"
          id={statusId}
          role="status"
        >
          {state.disabledReason}
        </span>
      </div>
      <NewEssayDialogFooter
        disabledReason={state.disabledReason}
        isCreating={isCreating}
        onCancel={onCancel}
        onSubmit={onSubmit}
        statusId={statusId}
        submitDisabled={state.submitDisabled}
      />
    </>
  );
}

export function NewEssayDialog({
  applications,
  initialType,
  isCreating,
  onCreate,
  onOpenChange,
  open,
}: {
  applications: ApplicationView[];
  initialType: EssayType;
  isCreating: boolean;
  onCreate: (input: NewEssayCreateInput) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const state = useNewEssayDialogState({
    applications,
    initialType,
    isCreating,
  });
  function submit() {
    if (state.submitDisabled) return;
    onCreate(buildCreateInput(state));
  }

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="flex max-h-[86svh] flex-col overflow-hidden">
          <NewEssayDialogFields
            applications={applications}
            isCreating={isCreating}
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            state={state}
          />
        </DialogContent>
      </Dialog>
      <AddSchoolDialog
        onAdded={(applicationId) => {
          state.setSelectedApplicationId(applicationId);
          state.setAddSchoolOpen(false);
        }}
        onOpenChange={state.setAddSchoolOpen}
        open={state.addSchoolOpen}
      />
    </>
  );
}
