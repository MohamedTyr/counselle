import { Check, ChevronDown, Circle, CircleDot } from "lucide-react";
import { useState, type ReactNode } from "react";

import type {
  ApplicationSupplements,
  EssaySummary,
  SupplementPrompt,
} from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSupplementActions } from "@/features/essays/supplement-actions";
import {
  choiceSummary,
  planSupplements,
  supplementSourceLine,
  wordLimitLabel,
  type SchoolSupplementPlan,
} from "@/features/essays/supplements-model";
import { essayTitleFromPrompt } from "@/features/dev-supplement-variants/variant-utils";
import { essayStatusVariant } from "@/lib/essay-display";
import { cn } from "@/lib/utils";

/* Variant 3 alternatives for the Essays card on a school's "Your
 * application" page. Each takes the school's prompts and the student's
 * essays for it, and renders the card body. */
type CardProps = { essays: EssaySummary[]; supplements: ApplicationSupplements };

function essayFor(prompt: SupplementPrompt, essays: EssaySummary[]) {
  return prompt.essay_id ? essays.find((e) => e.id === prompt.essay_id) : undefined;
}

function StartOrOpen({ applicationId, essay, prompt }: { applicationId: string; essay?: EssaySummary; prompt: SupplementPrompt }) {
  const actions = useSupplementActions();
  return essay ? (
    <Button size="sm" variant="ghost">Open</Button>
  ) : (
    <Button onClick={() => actions.start(applicationId, prompt.key)} size="sm" variant="outline">
      Write
    </Button>
  );
}

function StatusMark({ essay }: { essay?: EssaySummary }) {
  if (!essay) return <Circle aria-label="Not started" className="size-4 text-(--ink-faint)" />;
  if (essay.status === "Ready" || essay.status === "Submitted")
    return <Check aria-label="Done" className="size-4 text-(--success-fg)" />;
  return <CircleDot aria-label="In progress" className="size-4 text-(--ink-secondary)" />;
}

function owedPrompts(plan: SchoolSupplementPlan) {
  return [...plan.required, ...plan.choices.flatMap((c) => c.options.filter((o) => o.essay_id))];
}

function SourceLine({ supplements }: { supplements: ApplicationSupplements }) {
  return <p className="pt-3 text-xs text-muted-foreground">{supplementSourceLine(supplements)}</p>;
}

/* A: checklist. A summary line says how much is left; every prompt carries a
 * status mark, a bold short title, and the full prompt beneath. */
export function SchoolCardVariantA({ essays, supplements }: CardProps) {
  const plan = planSupplements(supplements);
  const owed = owedPrompts(plan);
  const started = owed.filter((p) => p.essay_id).length;
  const words = owed.reduce((sum, p) => sum + (p.word_limit ?? 0), 0);
  const row = (prompt: SupplementPrompt, note?: string | null) => {
    const essay = essayFor(prompt, essays);
    return (
      <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 py-3" key={prompt.key}>
        <span className="pt-0.5"><StatusMark essay={essay} /></span>
        <div className="min-w-0 max-w-[68ch]">
          {note ? <p className="text-xs font-medium text-muted-foreground">{note}</p> : null}
          <p className="text-sm font-semibold">{essayTitleFromPrompt(prompt.prompt)}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{prompt.prompt}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {essay ? `${essay.status} · ${essay.word_count}/${essay.word_limit ?? "–"} words` : wordLimitLabel(prompt.word_limit)}
          </p>
        </div>
        <StartOrOpen applicationId={supplements.application_id} essay={essay} prompt={prompt} />
      </li>
    );
  };
  const group = (title: string, items: ReactNode[]) =>
    items.length ? (
      <section className="pt-5 first:pt-0" key={title}>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</h3>
        <ul className="divide-y divide-(--hairline)">{items}</ul>
      </section>
    ) : null;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-(--control-quiet-surface) px-4 py-3">
        <p className="text-sm font-semibold tabular-nums">{started} of {owed.length} essays started</p>
        {words ? <p className="text-xs text-muted-foreground tabular-nums">About {words.toLocaleString()} words in total</p> : null}
      </div>
      {group("Every applicant writes", plan.required.map((p) => row(p)))}
      {plan.choices.map((c) => group(choiceSummary(c), c.options.map((p) => row(p))))}
      {group("Optional", plan.optional.map((p) => row(p)))}
      {group("For some applicants", plan.conditional.map((p) => row(p, p.applies_to)))}
      <SourceLine supplements={supplements} />
    </div>
  );
}

function AccordionRow({ applicationId, essay, note, prompt }: { applicationId: string; essay?: EssaySummary; note?: string | null; prompt: SupplementPrompt }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)">
        <span className="min-w-0">
          {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
          <span className="block truncate text-sm font-medium">{essayTitleFromPrompt(prompt.prompt)}</span>
        </span>
        {essay ? (
          <Badge variant={essayStatusVariant[essay.status]}>{essay.status}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{wordLimitLabel(prompt.word_limit)}</span>
        )}
        <ChevronDown aria-hidden="true" className={cn("size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <div className="flex flex-col gap-3 pb-4">
          <p className="max-w-[68ch] text-sm leading-6">{prompt.prompt}</p>
          <div><StartOrOpen applicationId={applicationId} essay={essay} prompt={prompt} /></div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* B: accordion. Each prompt is one short line (title, status or limit);
 * open it to read the full prompt and start. Long sets stay scannable. */
export function SchoolCardVariantB({ essays, supplements }: CardProps) {
  const plan = planSupplements(supplements);
  const row = (p: SupplementPrompt, note?: string | null) => (
    <li key={p.key}>
      <AccordionRow applicationId={supplements.application_id} essay={essayFor(p, essays)} note={note} prompt={p} />
    </li>
  );
  const group = (title: string, count: string, items: ReactNode[]) =>
    items.length ? (
      <section className="pt-5 first:pt-0" key={title}>
        <h3 className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
          <span>{title}</span>
          <span className="tabular-nums">{count}</span>
        </h3>
        <ul className="divide-y divide-(--hairline)">{items}</ul>
      </section>
    ) : null;
  const startedOf = (ps: SupplementPrompt[]) => `${ps.filter((p) => p.essay_id).length}/${ps.length} started`;
  return (
    <div>
      {group("Every applicant writes", startedOf(plan.required), plan.required.map((p) => row(p)))}
      {plan.choices.map((c) => group(choiceSummary(c), `${c.picked} chosen`, c.options.map((p) => row(p))))}
      {group("Optional", "", plan.optional.map((p) => row(p)))}
      {group("For some applicants", "", plan.conditional.map((p) => row(p, p.applies_to)))}
      <SourceLine supplements={supplements} />
    </div>
  );
}

/* C: two lanes. "You'll write" holds every essay the student owes, with a
 * progress bar each; "Still to decide" holds the choices and the extras. */
export function SchoolCardVariantC({ essays, supplements }: CardProps) {
  const plan = planSupplements(supplements);
  const owed = owedPrompts(plan);
  const actions = useSupplementActions();
  const openChoices = plan.choices.filter((c) => c.picked < (c.count ?? 1));
  const extras = [...plan.optional, ...plan.conditional].filter((p) => !p.essay_id);
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section>
        <h3 className="text-sm font-semibold">You’ll write</h3>
        <ul className="mt-1 divide-y divide-(--hairline)">
          {owed.map((p) => {
            const essay = essayFor(p, essays);
            const limit = p.word_limit ?? essay?.word_limit ?? null;
            const pct = essay && limit ? Math.min(100, Math.round((essay.word_count / limit) * 100)) : 0;
            return (
              <li className="py-3" key={p.key}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] leading-5 font-medium">{essayTitleFromPrompt(p.prompt)}</p>
                  <StartOrOpen applicationId={supplements.application_id} essay={essay} prompt={p} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 flex-1 rounded-full bg-(--control-quiet-surface)">
                    <div className="h-1 rounded-full bg-(--ink-secondary)" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {essay ? `${essay.word_count}/${limit ?? "–"}` : wordLimitLabel(limit)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Still to decide</h3>
        {openChoices.length === 0 && extras.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing left to choose.</p>
        ) : null}
        {openChoices.map((c) => (
          <div className="mt-2" key={c.label}>
            <p className="text-xs font-medium text-muted-foreground">{choiceSummary(c)}</p>
            <ul className="mt-1 flex flex-col">
              {c.options.filter((o) => !o.essay_id).map((o) => (
                <li key={o.key}>
                  <button
                    className="w-full rounded-md px-2 py-1.5 text-start text-[13px] leading-5 transition-colors duration-150 hover:bg-(--surface-hover) focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:outline-none"
                    onClick={() => actions.start(supplements.application_id, o.key)}
                    type="button"
                  >
                    {o.prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {extras.length ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground">You may also add</p>
            <ul className="mt-1 flex flex-col">
              {extras.map((p) => (
                <li className="flex items-start justify-between gap-3 py-1.5" key={p.key}>
                  <span className="text-[13px] leading-5">
                    {essayTitleFromPrompt(p.prompt)}
                    <span className="block text-xs text-muted-foreground">{p.applies_to ?? "Optional"}</span>
                  </span>
                  <StartOrOpen applicationId={supplements.application_id} prompt={p} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <SourceLine supplements={supplements} />
      </section>
    </div>
  );
}
