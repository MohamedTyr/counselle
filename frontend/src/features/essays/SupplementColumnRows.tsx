import { ChevronRight, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useStartSupplementEssay } from "@/api/workspace/hooks";
import type {
  ApplicationSupplements,
  SupplementPrompt,
} from "@/api/workspace/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  choiceIsSettled,
  choiceSummary,
  planSupplements,
  supplementSourceLine,
  type SupplementChoice,
} from "@/features/essays/supplements-model";
import { cn } from "@/lib/utils";

/* One prompt the student can start. The whole row is the control: the
 * prompt is what they are choosing, so it is the label, not a caption. */
function StartPromptRow({
  applicationId,
  note,
  prompt,
}: {
  applicationId: string;
  note?: string | null;
  prompt: SupplementPrompt;
}) {
  const start = useStartSupplementEssay();
  const pending = start.isPending && start.variables?.promptKey === prompt.key;
  return (
    <li>
      <button
        className="group/start grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2 text-start outline-none transition-colors duration-150 hover:bg-(--surface-hover) active:bg-(--surface-active) focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset disabled:cursor-progress"
        disabled={start.isPending}
        onClick={() => start.mutate({ applicationId, promptKey: prompt.key })}
        type="button"
      >
        <span className="min-w-0">
          {note ? (
            <span className="mb-0.5 block text-xs font-medium text-(--ink-muted)">
              {note}
            </span>
          ) : null}
          <span className="block text-[13px] leading-5 text-pretty text-(--ink-secondary) group-hover/start:text-(--ink)">
            {prompt.prompt}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium whitespace-nowrap text-(--ink-muted) group-hover/start:text-(--ink)">
          {pending ? (
            "Starting…"
          ) : (
            <>
              <Plus aria-hidden="true" className="size-3.5" />
              Write
            </>
          )}
        </span>
      </button>
    </li>
  );
}

function ChoiceBlock({
  applicationId,
  choice,
}: {
  applicationId: string;
  choice: SupplementChoice;
}) {
  const settled = choiceIsSettled(choice);
  const unpicked = choice.options.filter((option) => !option.essay_id);
  const [open, setOpen] = useState(false);
  const header = (
    <p className="flex items-baseline justify-between gap-3 px-3 pt-2.5 pb-1 text-xs">
      <span className="font-medium text-(--ink-secondary)">
        {choiceSummary(choice)}
      </span>
      {choice.picked > 0 ? (
        <span className="shrink-0 text-(--ink-muted) tabular-nums">
          {choice.picked} picked
        </span>
      ) : null}
    </p>
  );
  if (!settled) {
    return (
      <div className="border-t border-(--hairline) pb-1" data-slot="supplement-choice">
        {header}
        <ul>
          {unpicked.map((option) => (
            <StartPromptRow
              applicationId={applicationId}
              key={option.key}
              prompt={option}
            />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <Collapsible
      className="border-t border-(--hairline)"
      data-slot="supplement-choice"
      onOpenChange={setOpen}
      open={open}
    >
      {header}
      {unpicked.length > 0 ? (
        <>
          <DisclosureTrigger open={open}>
            {unpicked.length === 1
              ? "The other option"
              : `The other ${unpicked.length} options`}
          </DisclosureTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
            <ul className="pb-1">
              {unpicked.map((option) => (
                <StartPromptRow
                  applicationId={applicationId}
                  key={option.key}
                  prompt={option}
                />
              ))}
            </ul>
          </CollapsibleContent>
        </>
      ) : null}
    </Collapsible>
  );
}

function DisclosureTrigger({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) {
  return (
    <CollapsibleTrigger
      className="flex w-full items-center gap-1 px-3 py-2 text-start text-xs font-medium text-(--ink-muted) outline-none transition-colors duration-150 hover:bg-(--surface-hover) hover:text-(--ink) active:bg-(--surface-active) focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
          open && "rotate-90",
        )}
      />
      {children}
    </CollapsibleTrigger>
  );
}

/* Optional prompts and ones for some applicants stay folded: most students
 * write none of them, and listing them open would bury the essays they owe. */
function MoreFromSchool({
  applicationId,
  conditional,
  optional,
}: {
  applicationId: string;
  conditional: SupplementPrompt[];
  optional: SupplementPrompt[];
}) {
  const [open, setOpen] = useState(false);
  const notStarted = [...optional, ...conditional].filter((p) => !p.essay_id);
  if (notStarted.length === 0) return null;
  const optionalCount = optional.filter((p) => !p.essay_id).length;
  const conditionalCount = notStarted.length - optionalCount;
  const label = [
    optionalCount ? `${optionalCount} optional` : null,
    conditionalCount ? `${conditionalCount} for some applicants` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Collapsible
      className="border-t border-(--hairline)"
      data-slot="supplement-more"
      onOpenChange={setOpen}
      open={open}
    >
      <DisclosureTrigger open={open}>{label}</DisclosureTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <ul className="pb-1">
          {notStarted.map((prompt) => (
            <StartPromptRow
              applicationId={applicationId}
              key={prompt.key}
              note={prompt.applies_to ?? "Optional"}
              prompt={prompt}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* The supplement half of a school column on the Essays tab: the choices the
 * student still has to make, the prompts they may add, and where the
 * prompts came from. Essays already created render above as ordinary rows. */
export function SupplementColumnRows({
  supplements,
}: {
  supplements: ApplicationSupplements | undefined;
}) {
  if (!supplements) return null;
  if (supplements.status === "none") {
    return (
      <p className="border-t border-(--hairline) px-3 py-2.5 text-xs text-(--ink-muted)">
        No supplemental essays this year
      </p>
    );
  }
  if (supplements.status === "unlisted") {
    return (
      <p className="border-t border-(--hairline) px-3 py-2.5 text-xs text-(--ink-muted)">
        Prompts not listed yet
      </p>
    );
  }
  const plan = planSupplements(supplements);
  const applicationId = supplements.application_id;
  return (
    <>
      {plan.choices.map((choice) => (
        <ChoiceBlock applicationId={applicationId} choice={choice} key={choice.label} />
      ))}
      <MoreFromSchool
        applicationId={applicationId}
        conditional={plan.conditional}
        optional={plan.optional}
      />
    </>
  );
}

/* Where the prompts came from, as the column's last line. */
export function SupplementSourceNote({
  supplements,
}: {
  supplements: ApplicationSupplements | undefined;
}) {
  const line = supplements ? supplementSourceLine(supplements) : null;
  if (!line) return null;
  return (
    <p className="border-t border-(--hairline) px-3 py-2 text-xs text-(--ink-faint)">
      {line}
    </p>
  );
}
