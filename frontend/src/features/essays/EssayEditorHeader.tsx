import { ChevronDown, GraduationCap } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { useUpdateEssay } from "@/api/workspace/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { EssayStatus, Essay } from "@/domain/essay";
import { PROMPT_PLACEHOLDER } from "@/features/essays/EssayPromptComposer";
import { formatEssayDeadline } from "@/lib/essay-display";
import { cn } from "@/lib/utils";

/**
 * `Drafting` used to be `bg-info`, which has painted nothing since the `--info`
 * role was deleted from the palette — `bg-info` resolves to transparent, so the
 * dot was simply absent and the label carried the status alone. Drafting is the
 * ordinary state of an essay, and the palette's rule is that a hue is a claim
 * about state: the ordinary one lands on the neutral role (see the --info
 * deletion note in `primitives.css`), one step darker than `Not started` so the
 * two still read apart.
 */
const statusDotClassName: Record<EssayStatus, string> = {
  "Not started": "bg-[var(--ink-faint)]",
  Drafting: "bg-[var(--neutral-fg)]",
  "Needs review": "bg-warning",
  Ready: "bg-success",
  Submitted: "bg-success",
};

/**
 * The read-only half of the menu body: the prompt itself (or its absence,
 * rule 34 — words, never a blank) plus the one affordance to change it.
 * "Edit prompt" and "Add prompt" are the same control under two labels
 * (rule 33 — say the noun) rather than two separate buttons.
 */
function PromptView({
  buttonRef,
  onEdit,
  prompt,
}: {
  buttonRef: React.Ref<HTMLButtonElement>;
  onEdit: () => void;
  prompt: string | null;
}) {
  return (
    <>
      {prompt ? (
        <p className="text-sm leading-6 text-popover-foreground">{prompt}</p>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          No prompt added yet.
        </p>
      )}
      <Button
        className="self-start"
        onClick={onEdit}
        ref={buttonRef}
        size="sm"
        type="button"
        variant={prompt ? "ghost" : "outline"}
      >
        {prompt ? "Edit prompt" : "Add prompt"}
      </Button>
    </>
  );
}

/**
 * The mutation call, lifted out of `PromptEditForm` so that component stays
 * under the house function-length limit (mirrors `createSupplementEssay` in
 * `SchoolEssaysSection.tsx`). An unchanged, all-whitespace, or empty draft
 * clears/no-ops rather than firing a redundant PATCH — `null`, never `""`,
 * is how "no prompt" is represented everywhere else in this refactor. Errors
 * are swallowed deliberately: the mutation hook owns optimistic rollback and
 * the error toast, and leaving `onDone` uncalled on failure keeps the form
 * (and the student's draft) open to retry.
 */
async function savePrompt({
  draft,
  essayId,
  onDone,
  prompt,
  updateEssay,
}: {
  draft: string;
  essayId: string;
  onDone: () => void;
  prompt: string | null;
  updateEssay: ReturnType<typeof useUpdateEssay>;
}): Promise<void> {
  const normalized = draft.trim() || null;
  if (normalized === prompt) {
    onDone();
    return;
  }
  try {
    await updateEssay.mutateAsync({ id: essayId, patch: { prompt: normalized } });
    onDone();
  } catch {
    // Mutation hook owns optimistic rollback and error toast behavior.
  }
}

/**
 * The prompt's inline edit form — a plain `Textarea`, not
 * `EssayPromptComposer`. The composer is the one existing prompt-entry
 * pattern (rule 21), but it inseparably bundles a word-limit field, and this
 * surface deliberately stays prompt-only: the trigger is titled "Prompt", the
 * word limit already has a display elsewhere in the editor toolbar, and
 * pulling the composer in would grow this into a second, unrelated edit.
 * Splitting the composer to reuse half of it would be a refactor smuggled
 * into this change (rule 19), so a bare `Textarea` is the smaller diff.
 *
 * Saving is explicit — a Save button, no autosave-on-keystroke — because a
 * half-typed quote from a real school's prompt should never be persisted
 * mid-edit.
 *
 * `draft` is owned by `PromptMenu`, not this component: the menu's Escape
 * and outside-click guards (see `PromptMenu`) need to know whether the
 * draft differs from the saved prompt, so the text has to live where those
 * handlers can read it.
 */
function PromptEditForm({
  draft,
  essayId,
  onDone,
  onDraftChange,
  prompt,
}: {
  draft: string;
  essayId: string;
  onDone: () => void;
  onDraftChange: (value: string) => void;
  prompt: string | null;
}) {
  const updateEssay = useUpdateEssay();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Prompt"
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        placeholder={PROMPT_PLACEHOLDER}
        ref={fieldRef}
        value={draft}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={updateEssay.isPending}
          onClick={() =>
            void savePrompt({ draft, essayId, onDone, prompt, updateEssay })
          }
          size="sm"
          type="button"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function PromptMenuTrigger() {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        className="h-8 text-muted-foreground hover:text-foreground"
        title="Prompt"
        type="button"
        variant="ghost"
      >
        <GraduationCap aria-hidden="true" data-icon="inline-start" />
        {/*
         * Drops to icon-only below `xl`, where the editor header has to fit
         * nine things into ~410px beside a full-width sidebar. `sr-only`
         * rather than `hidden` so the button keeps its accessible name at
         * every width — the label stops being painted, not announced.
         */}
        <span className="sr-only xl:not-sr-only">Prompt</span>
        <ChevronDown aria-hidden="true" data-icon="inline-end" />
      </Button>
    </DropdownMenuTrigger>
  );
}

function PromptMenuHeading({ prompt }: { prompt: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <GraduationCap aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-medium">{prompt ? "Prompt" : "No prompt"}</p>
        <p className="text-xs text-muted-foreground">Essay reference</p>
      </div>
    </div>
  );
}

/**
 * The mode (`isEditing`), the in-progress `draft`, and the "Edit prompt"/
 * "Add prompt" button ref that focus returns to. Split out of
 * `usePromptMenuState` (and that in turn out of `PromptMenu`) to keep every
 * function under the house length limit.
 */
function useEditableDraft(prompt: string | null) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(prompt ?? "");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const isDirty = draft !== (prompt ?? "");

  // Focus restore (Cancel/Save) has to wait for `PromptEditForm` to unmount
  // and the "Edit prompt"/"Add prompt" button to remount in its place.
  useEffect(() => {
    if (!isEditing && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      editButtonRef.current?.focus();
    }
  }, [isEditing]);

  function enterEditMode() {
    setDraft(prompt ?? "");
    setIsEditing(true);
  }

  function exitEditMode() {
    shouldRestoreFocusRef.current = true;
    setIsEditing(false);
  }

  return {
    draft,
    editButtonRef,
    enterEditMode,
    exitEditMode,
    isDirty,
    isEditing,
    setDraft,
    setIsEditing,
  };
}

/**
 * A half-typed prompt must not vanish just because focus strayed onto the
 * header behind the menu, but Escape still has to do *something*
 * predictable (DESIGN.md §16.1 — "Escape closes every overlay"). While
 * dirty, the first Escape only arms a second one: it blocks the close and
 * leaves the draft untouched. A second Escape while still dirty is let
 * through to Radix's default handling and closes the menu — now an
 * explicit, twice-confirmed discard, not a silent one. An outside click has
 * no "press again" gesture to detect, so it is simply blocked while dirty;
 * Save, Cancel, or the two-Escape path are the only ways out. Entering edit
 * mode re-arms; Save/Cancel exit edit mode, which clears `isDirty` and
 * returns Escape to closing on the first press once there is nothing left
 * to lose.
 */
function useDiscardGuard(
  isEditing: boolean,
  isDirty: boolean,
  setIsEditing: (value: boolean) => void,
) {
  const [armed, setArmed] = useState(false);

  function resetArmed() {
    setArmed(false);
  }

  function handleEscapeKeyDown(event: KeyboardEvent) {
    if (!isEditing || !isDirty || armed) return;
    event.preventDefault();
    setArmed(true);
  }

  function handleInteractOutside(event: Event) {
    if (isEditing && isDirty) event.preventDefault();
  }

  function handleOpenChange(open: boolean) {
    if (!open) setIsEditing(false);
  }

  return {
    handleEscapeKeyDown,
    handleInteractOutside,
    handleOpenChange,
    resetArmed,
  };
}

// Composes the two: entering edit mode has to re-arm the discard guard, so
// `enterEditMode` is wrapped here rather than inside either hook alone.
function usePromptMenuState(prompt: string | null) {
  const editable = useEditableDraft(prompt);
  const guard = useDiscardGuard(
    editable.isEditing,
    editable.isDirty,
    editable.setIsEditing,
  );

  function enterEditMode() {
    guard.resetArmed();
    editable.enterEditMode();
  }

  return { ...editable, ...guard, enterEditMode };
}

export function PromptMenu({
  essayId,
  prompt,
}: {
  essayId: string;
  prompt: string | null;
}) {
  const menu = usePromptMenuState(prompt);

  return (
    <DropdownMenu onOpenChange={menu.handleOpenChange}>
      <PromptMenuTrigger />
      <DropdownMenuContent
        align="end"
        className="w-80 p-0 sm:w-96"
        onEscapeKeyDown={menu.handleEscapeKeyDown}
        onInteractOutside={menu.handleInteractOutside}
        sideOffset={8}
      >
        <div className="flex flex-col gap-3 p-4">
          <PromptMenuHeading prompt={prompt} />
          {menu.isEditing ? (
            <PromptEditForm
              draft={menu.draft}
              essayId={essayId}
              onDone={menu.exitEditMode}
              onDraftChange={menu.setDraft}
              prompt={prompt}
            />
          ) : (
            <PromptView
              buttonRef={menu.editButtonRef}
              onEdit={menu.enterEditMode}
              prompt={prompt}
            />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HeaderDivider() {
  return (
    <span
      aria-hidden="true"
      className="hidden h-4 w-px bg-(--essay-editor-header-border) sm:block"
    />
  );
}

export function EssayStatusIndicator({
  className,
  status,
}: {
  className?: string;
  status: EssayStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", statusDotClassName[status])}
      />
      {status}
    </span>
  );
}

export function EssayContextTrail({ essay }: { essay: Essay }) {
  const deadlineLabel = formatEssayDeadline(essay.deadline);
  const trail = [essay.schoolName, essay.type, deadlineLabel];

  return (
    <nav aria-label="Essay context" className="mt-1.5">
      <ol className="hidden min-w-0 items-center gap-x-2 overflow-hidden text-sm leading-5 text-muted-foreground sm:flex sm:flex-nowrap">
        {trail.map((item, index) => (
          <li
            className={cn(
              "flex min-w-0 items-center gap-2",
              index === trail.length - 1 && "shrink-0",
            )}
            key={`${index}-${item}`}
          >
            {index > 0 ? (
              <span aria-hidden="true" className="text-border">
                /
              </span>
            ) : null}
            {index === 0 && essay.applicationId ? (
              <Link
                className="truncate rounded-sm font-medium text-[var(--ink-secondary)] outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
                to={`/app/schools/${essay.applicationId}`}
              >
                {item}
                {index === 0
                  ? essay.cycleYear
                    ? ` · ${essay.cycleYear - 1}-${String(essay.cycleYear).slice(-2)}`
                    : " · Cycle unconfirmed"
                  : ""}
              </Link>
            ) : (
              <span
                className={cn(
                  "truncate",
                  index === 0 && "font-medium text-[var(--ink-secondary)]",
                )}
              >
                {item}
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-0.5 text-sm leading-5 text-muted-foreground sm:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {essay.applicationId ? (
            <Link
              className="truncate rounded-sm font-medium text-[var(--ink-secondary)] outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
              to={`/app/schools/${essay.applicationId}`}
            >
              {essay.schoolName}
              {essay.cycleYear
                ? ` · ${essay.cycleYear - 1}-${String(essay.cycleYear).slice(-2)}`
                : " · Cycle unconfirmed"}
            </Link>
          ) : (
            <span className="truncate font-medium text-[var(--ink-secondary)]">
              {essay.schoolName}
            </span>
          )}
          <span aria-hidden="true" className="shrink-0 text-border">
            /
          </span>
          <span className="truncate">{essay.type}</span>
        </div>
        <span className="whitespace-nowrap">{deadlineLabel}</span>
      </div>
    </nav>
  );
}
