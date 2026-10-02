import { Check, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";

import type { ApplicationSupplements } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSupplementActions } from "@/features/essays/supplement-actions";
import {
  choiceIsSettled,
  planSupplements,
  type SupplementChoice,
} from "@/features/essays/supplements-model";
import { essayTitleFromPrompt } from "@/features/dev-supplement-variants/variant-utils";
import { cn } from "@/lib/utils";

/* Variant 1 alternatives for the choice block inside an Essays-tab column. */

function pickLabel(choice: SupplementChoice) {
  const total = choice.options.length;
  const pick =
    choice.count === null ? `Choose any of ${total}` : `Choose ${choice.count} of ${total}`;
  return choice.optional ? `${pick} · optional` : pick;
}

/* A: radio picker. Reading and committing are two steps: select a prompt,
 * then one "Start writing" button creates the essay. */
function RadioChoice({ applicationId, choice }: { applicationId: string; choice: SupplementChoice }) {
  const actions = useSupplementActions();
  const [selected, setSelected] = useState<string | null>(null);
  const picked = choice.options.filter((o) => o.essay_id);
  const settled = choiceIsSettled(choice);
  return (
    <fieldset className="border-t border-(--hairline) px-3 pt-3 pb-3">
      <legend className="sr-only">{pickLabel(choice)}</legend>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-(--ink)">{pickLabel(choice)}</span>
        {choice.wordLimit ? (
          <span className="text-(--ink-muted) tabular-nums">{choice.wordLimit} words</span>
        ) : null}
      </div>
      {settled ? (
        <p className="flex items-start gap-2 text-[13px] leading-5 text-(--ink-secondary)">
          <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-(--success-fg)" />
          <span>You chose: {essayTitleFromPrompt(picked[0]?.prompt ?? "")}</span>
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {choice.options.map((option) => (
              <label
                className={cn(
                  "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-lg px-2 py-2 text-[13px] leading-5 text-(--ink-secondary) transition-colors duration-150 hover:bg-(--surface-hover)",
                  selected === option.key && "bg-(--surface-hover) text-(--ink)",
                )}
                key={option.key}
              >
                <input
                  checked={selected === option.key}
                  className="mt-1 size-3.5 accent-(--ink)"
                  name={`choice-${applicationId}-${choice.label}`}
                  onChange={() => setSelected(option.key)}
                  type="radio"
                />
                <span>{option.prompt}</span>
              </label>
            ))}
          </div>
          <Button
            className="mt-2 w-full"
            disabled={selected === null}
            onClick={() => selected && actions.start(applicationId, selected)}
            size="sm"
            variant="outline"
          >
            Start writing
          </Button>
        </>
      )}
    </fieldset>
  );
}

/* B: collapsed summary. One quiet line until the student opens it; the
 * open state lists every prompt in full with its own Write action. */
function CollapsedChoice({ applicationId, choice }: { applicationId: string; choice: SupplementChoice }) {
  const actions = useSupplementActions();
  const [open, setOpen] = useState(false);
  const settled = choiceIsSettled(choice);
  return (
    <Collapsible className="border-t border-(--hairline)" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-start outline-none transition-colors duration-150 hover:bg-(--surface-hover) focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-(--ink)">{pickLabel(choice)}</span>
          <span className="block text-xs text-(--ink-muted)">
            {settled
              ? `${choice.picked} chosen`
              : choice.wordLimit
                ? `${choice.wordLimit} words · not chosen yet`
                : "Not chosen yet"}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 text-(--ink-muted) transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <ol className="flex flex-col gap-3 px-3 pb-3">
          {choice.options.map((option) => (
            <li className="flex flex-col gap-1.5" key={option.key}>
              <p className="text-[13px] leading-5 text-(--ink-secondary)">{option.prompt}</p>
              {option.essay_id ? (
                <span className="flex items-center gap-1 text-xs font-medium text-(--success-fg)">
                  <Check aria-hidden="true" className="size-3.5" /> Chosen
                </span>
              ) : (
                <button
                  className="w-fit rounded-sm text-xs font-medium text-(--ink) underline decoration-(--hairline) underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
                  onClick={() => actions.start(applicationId, option.key)}
                  type="button"
                >
                  Choose this prompt
                </button>
              )}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* C: lettered options. Each option leads with a short bold title so the
 * three read apart at a glance; the full prompt sits under it. */
function LetteredChoice({ applicationId, choice }: { applicationId: string; choice: SupplementChoice }) {
  const actions = useSupplementActions();
  return (
    <div className="border-t border-(--hairline) px-3 pt-3 pb-1">
      <p className="text-xs font-semibold text-(--ink)">
        {pickLabel(choice)}
        {choice.wordLimit ? (
          <span className="font-normal text-(--ink-muted)"> · {choice.wordLimit} words</span>
        ) : null}
      </p>
      <ul className="mt-2 divide-y divide-(--hairline)">
        {choice.options.map((option, index) => (
          <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-2.5" key={option.key}>
            <span
              aria-hidden="true"
              className={cn(
                "mt-px flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                option.essay_id
                  ? "bg-(--success-surface) text-(--success-fg)"
                  : "bg-(--control-quiet-surface) text-(--ink-secondary)",
              )}
            >
              {option.essay_id ? <Check className="size-3" /> : String.fromCharCode(65 + index)}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] leading-5 font-semibold text-(--ink)">
                {essayTitleFromPrompt(option.prompt)}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-(--ink-muted)">{option.prompt}</p>
              {option.essay_id ? (
                <p className="mt-1 text-xs font-medium text-(--success-fg)">Chosen</p>
              ) : (
                <Button
                  className="mt-1.5 h-7 px-2.5 text-xs"
                  onClick={() => actions.start(applicationId, option.key)}
                  size="sm"
                  variant="ghost"
                >
                  <Plus data-icon="inline-start" />
                  Write this one
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderChoices(
  supplements: ApplicationSupplements,
  Block: typeof RadioChoice,
) {
  return planSupplements(supplements).choices.map((choice) => (
    <Block applicationId={supplements.application_id} choice={choice} key={choice.label} />
  ));
}

export function ChoiceVariantA({ supplements }: { supplements: ApplicationSupplements }) {
  return <>{renderChoices(supplements, RadioChoice)}</>;
}
export function ChoiceVariantB({ supplements }: { supplements: ApplicationSupplements }) {
  return <>{renderChoices(supplements, CollapsedChoice)}</>;
}
export function ChoiceVariantC({ supplements }: { supplements: ApplicationSupplements }) {
  return <>{renderChoices(supplements, LetteredChoice)}</>;
}
