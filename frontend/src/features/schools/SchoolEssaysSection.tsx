import { BookOpenText, Plus } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { useCreateEssay } from "@/api/workspace/hooks";
import type { ApplicationDetail, EssaySummary } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  EssayPromptComposer,
  isWordLimitInvalid,
  parseWordLimit,
} from "@/features/essays/EssayPromptComposer";
import { cycleLabel } from "@/features/schools/school-workspace-format";

/** Rule 34: an absent prompt renders as words, never a blank word count. */
function essayProgress(essay: EssaySummary): string {
  if (!essay.prompt) return "No prompt";
  return essay.word_limit
    ? `${essay.word_count}/${essay.word_limit}`
    : `${essay.word_count} words`;
}

function EssayRow({ essay }: { essay: EssaySummary }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{essay.title}</p>
        <p className="text-xs text-muted-foreground">
          {essay.status} · {essayProgress(essay)}
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
  );
}

/*
 * The composer draws no border and no fill (rule 9, §17.2 — a bordered
 * sub-panel here would be a card inside a card). It is just another row of
 * the divide-y list its caller renders it inside, separated from the essays
 * below it by the same --hairline rule. The row's own vertical rhythm
 * (`py-5 first:pt-0 last:pb-0`) lives on the `CollapsibleContent` wrapper in
 * the caller, not here — that's the element that is actually a sibling of
 * the essay rows in the divide-y list, so it's the one whose `first`/`last`
 * pseudo-classes need to see the real list position.
 */
/**
 * The mutation + navigate side effect, lifted out of `AddEssayRow` so that
 * component stays under the house function-length limit. Errors are
 * swallowed deliberately: the mutation hook owns optimistic rollback and
 * the error toast, so there is nothing left for the caller to do.
 */
async function createSupplementEssay({
  applicationId,
  createEssay,
  navigate,
  prompt,
  schoolName,
  wordLimitText,
}: {
  applicationId: string;
  createEssay: ReturnType<typeof useCreateEssay>;
  navigate: ReturnType<typeof useNavigate>;
  prompt: string;
  schoolName: string;
  wordLimitText: string;
}): Promise<void> {
  try {
    const created = await createEssay.mutateAsync({
      application_id: applicationId,
      essay_type: "Supplement",
      prompt: prompt.trim() || null,
      status: "Not started",
      title: `${schoolName} supplement`,
      word_limit: parseWordLimit(wordLimitText),
    });
    void navigate(`/app/essays/${created.id}`);
  } catch {
    // Mutation hooks own optimistic rollback and error toast behavior.
  }
}

function AddEssayActions({
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button onClick={onCancel} size="sm" variant="ghost">
        Cancel
      </Button>
      <Button disabled={isSubmitting} onClick={onSubmit} size="sm">
        Add essay
      </Button>
    </div>
  );
}

interface AddEssayRowProps {
  applicationId: string;
  onCancel: () => void;
  schoolName: string;
}

/**
 * `submit` blocks rather than disabling [Add essay] on an invalid word
 * limit: a disabled button would hide *why* it won't respond, while
 * `EssayPromptComposer` already shows that inline as soon as it's typed.
 */
function AddEssayRow({
  applicationId,
  onCancel,
  schoolName,
}: AddEssayRowProps) {
  const navigate = useNavigate();
  const createEssay = useCreateEssay();
  const [prompt, setPrompt] = useState("");
  const [wordLimitText, setWordLimitText] = useState("");
  const promptFieldRef = useRef<HTMLTextAreaElement>(null);
  const wordLimitFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    promptFieldRef.current?.focus();
  }, []);

  function submit() {
    if (isWordLimitInvalid(wordLimitText)) {
      wordLimitFieldRef.current?.focus();
      return;
    }
    void createSupplementEssay({
      applicationId,
      createEssay,
      navigate,
      prompt,
      schoolName,
      wordLimitText,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <EssayPromptComposer
        onPromptChange={setPrompt}
        onWordLimitChange={setWordLimitText}
        prompt={prompt}
        promptFieldRef={promptFieldRef}
        wordLimit={wordLimitText}
        wordLimitFieldRef={wordLimitFieldRef}
      />
      <AddEssayActions
        isSubmitting={createEssay.isPending}
        onCancel={onCancel}
        onSubmit={submit}
      />
    </div>
  );
}

/**
 * The card's zero-essay state. Rendered as a sibling of `CollapsibleContent`
 * inside the same `divide-y` list rather than swapped in for it — see the
 * comment above `SchoolEssaysSection`'s return for why that placement is
 * load-bearing for the collapse animation.
 */
function EssaysEmptyState({
  onAddEssay,
  onCopyRequest,
}: {
  onAddEssay: () => void;
  onCopyRequest: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookOpenText />
        </EmptyMedia>
        <EmptyTitle>No essays yet</EmptyTitle>
        <EmptyDescription>
          Add a supplement for this school, with or without the prompt.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex flex-wrap justify-center gap-2">
        <Button onClick={onAddEssay}>
          <Plus data-icon="inline-start" />
          Add essay
        </Button>
        <Button onClick={onCopyRequest} variant="outline">
          Copy research request
        </Button>
      </EmptyContent>
    </Empty>
  );
}

interface EssaysListProps {
  applicationId: string;
  composerOpen: boolean;
  onAddEssay: () => void;
  onCancelComposer: () => void;
  onComposerKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onCopyRequest: () => void;
  schoolEssays: EssaySummary[];
  schoolName: string;
}

/**
 * The `divide-y` list — composer row plus essays or the empty state. Kept
 * as its own component so `SchoolEssaysSection` stays under the house
 * function-length limit; extracted whole (not split further) because the
 * container, `CollapsibleContent`, and the empty/non-empty split all have
 * to stay mounted together for the collapse animation to land (see the
 * comment on the outer `div` below).
 */
function EssaysList({
  applicationId,
  composerOpen,
  onAddEssay,
  onCancelComposer,
  onComposerKeyDown,
  onCopyRequest,
  schoolEssays,
  schoolName,
}: EssaysListProps) {
  // Mirrors whether CollapsibleContent is actually present in the DOM
  // (mounted while open, and for the duration of its exit animation while
  // closing), not just `composerOpen`. Radix's Presence keeps the node
  // mounted until the exit animation's `animationend` fires, so gating the
  // empty state on `composerOpen` alone shows both the closing composer row
  // and `EssaysEmptyState` at once for that ~200ms. This ref callback tracks
  // the same mount signal Presence itself uses, so it self-corrects for
  // `prefers-reduced-motion` and jsdom: both skip the animation and unmount
  // synchronously, so `composerMounted` flips false in the same tick and the
  // empty state appears immediately, exactly as before this fix.
  const [composerMounted, setComposerMounted] = useState(false);
  return (
    <div className="divide-y divide-[var(--hairline)]">
      {/*
       * This container and CollapsibleContent inside it stay mounted across
       * the empty/non-empty split below. Radix's Presence needs the closing
       * element to survive the render where `composerOpen` flips false so
       * it can play the collapse animation instead of the tree just
       * swapping it for `EssaysEmptyState` in the same tick.
       *
       * Real height transition (DESIGN §12.4), not a fade: Radix exposes
       * the measured content height as
       * `--radix-collapsible-content-height`, and tw-animate-css's
       * `animate-collapsible-*` utilities (already imported app-wide, no
       * new @keyframes) animate `height` between 0 and that value.
       * `motion-reduce:animate-none` drops straight to the end state for
       * reduced-motion users.
       */}
      <CollapsibleContent
        className="overflow-hidden py-5 first:pt-0 last:pb-0 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none"
        onKeyDown={onComposerKeyDown}
        ref={(node) => setComposerMounted(node !== null)}
      >
        <AddEssayRow
          applicationId={applicationId}
          onCancel={onCancelComposer}
          schoolName={schoolName}
        />
      </CollapsibleContent>
      {schoolEssays.length === 0 && !composerOpen && !composerMounted ? (
        <EssaysEmptyState onAddEssay={onAddEssay} onCopyRequest={onCopyRequest} />
      ) : (
        schoolEssays.map((essay) => <EssayRow essay={essay} key={essay.id} />)
      )}
    </div>
  );
}

async function copySuggestedRequest(suggestedRequest: string) {
  try {
    await navigator.clipboard.writeText(suggestedRequest);
    toast.success("Research request copied");
  } catch {
    toast.error("Could not copy the research request");
  }
}

/**
 * Escape has no built-in Collapsible handling (that's a Dialog/Popover
 * behavior) — wired up here so a student who opens the composer by
 * accident isn't stuck tabbing forward to Cancel. Bubble-phase, so
 * anything nested that wants to handle Escape itself gets first refusal.
 */
function handleComposerEscape(
  event: React.KeyboardEvent<HTMLDivElement>,
  onClose: () => void,
) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  onClose();
}

export function SchoolEssaysSection({ detail }: { detail: ApplicationDetail }) {
  const [composerOpen, setComposerOpen] = useState(false);
  const addEssayButtonRef = useRef<HTMLButtonElement>(null);
  const schoolEssays = detail.essays.filter(
    (essay) => essay.essay_type !== "Personal statement",
  );
  const suggestedRequest = `Find the official ${cycleLabel(detail.application.cycle_year)} supplemental essay prompts for ${detail.application.school_name}. Cite each source and clearly mark anything uncertain.`;

  function closeComposer() {
    setComposerOpen(false);
    addEssayButtonRef.current?.focus();
  }

  return (
    <section className="flex scroll-mt-20 flex-col gap-5" id="essays">
      <Collapsible onOpenChange={setComposerOpen} open={composerOpen}>
        <Card>
          <CardHeader>
            <CardTitle render={<h2 />}>Essays</CardTitle>
            <CardAction>
              <Button
                render={<CollapsibleTrigger />}
                ref={addEssayButtonRef}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus data-icon="inline-start" />
                Add essay
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <EssaysList
              applicationId={detail.application.id}
              composerOpen={composerOpen}
              onAddEssay={() => setComposerOpen(true)}
              onCancelComposer={closeComposer}
              onComposerKeyDown={(event) => handleComposerEscape(event, closeComposer)}
              onCopyRequest={() => void copySuggestedRequest(suggestedRequest)}
              schoolEssays={schoolEssays}
              schoolName={detail.application.school_name}
            />
          </CardContent>
        </Card>
      </Collapsible>
    </section>
  );
}
