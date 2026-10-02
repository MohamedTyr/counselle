import type { ReactNode } from "react";
import { Link } from "react-router";

import { useStartSupplementEssay } from "@/api/workspace/hooks";
import type {
  ApplicationSupplements,
  EssaySummary,
  SupplementPrompt,
} from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { promptChangeFromSummary } from "@/domain/essay";
import { PromptChangeNotice } from "@/features/essays/PromptChangeNotice";
import {
  choiceSummary,
  planSupplements,
  supplementSourceLine,
  wordLimitLabel,
} from "@/features/essays/supplements-model";
import { essayStatusVariant } from "@/lib/essay-display";

function essayProgress(essay: EssaySummary) {
  return essay.word_limit
    ? `${essay.word_count}/${essay.word_limit} words`
    : `${essay.word_count} words`;
}

/* One prompt in full, with the student's essay for it or a way to start one.
 * The prompt is the content here, so it gets body size, not a caption. */
function PromptRow({
  applicationId,
  essay,
  note,
  prompt,
}: {
  applicationId: string;
  essay: EssaySummary | undefined;
  note?: string | null;
  prompt: SupplementPrompt;
}) {
  const start = useStartSupplementEssay();
  const change = essay ? promptChangeFromSummary(essay) : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 py-3.5">
      <div className="min-w-0">
        {note ? (
          <p className="mb-1 text-xs font-medium text-muted-foreground">{note}</p>
        ) : null}
        {prompt.context ? (
          <blockquote className="mb-2 max-w-[68ch] border-s border-(--hairline) ps-3 text-[13px] leading-5 whitespace-pre-line text-muted-foreground">
            {prompt.context}
          </blockquote>
        ) : null}
        <p className="max-w-[68ch] text-sm leading-6 text-pretty">{prompt.prompt}</p>
      </div>
      <div className="row-span-2 self-start">
        {essay ? (
          <Button
            render={<Link to={`/app/essays/${essay.id}`} />}
            size="sm"
            variant="ghost"
          >
            Open
          </Button>
        ) : (
          <Button
            disabled={start.isPending}
            onClick={() =>
              start.mutate({ applicationId, promptKey: prompt.key })
            }
            size="sm"
            variant="outline"
          >
            {start.isPending ? "Starting…" : "Write"}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
        {essay ? (
          <>
            <Badge variant={essayStatusVariant[essay.status]}>{essay.status}</Badge>
            <span>{essayProgress(essay)}</span>
          </>
        ) : (
          <span>{wordLimitLabel(prompt.word_limit)}</span>
        )}
      </div>
      {essay && change ? (
        <PromptChangeNotice
          change={change}
          className="col-span-2"
          essayId={essay.id}
          prompt={essay.prompt}
        />
      ) : null}
    </li>
  );
}

function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="pt-4 first:pt-0">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-(--hairline)">{children}</ul>
    </section>
  );
}

/* The school's supplemental prompts on its "Your application" page, grouped
 * by what the student owes: the ones every applicant writes, each choice,
 * then the optional and program-specific ones. Essays the student wrote for
 * prompts not on the list follow under "Your other essays". */
export function SchoolSupplementList({
  essays,
  supplements,
}: {
  essays: EssaySummary[];
  supplements: ApplicationSupplements;
}) {
  const plan = planSupplements(supplements);
  const byId = new Map(essays.map((essay) => [essay.id, essay]));
  const linked = new Set(
    supplements.prompts.flatMap((p) => (p.essay_id ? [p.essay_id] : [])),
  );
  const others = essays.filter((essay) => !linked.has(essay.id));
  const row = (prompt: SupplementPrompt, note?: string | null) => (
    <PromptRow
      applicationId={supplements.application_id}
      essay={prompt.essay_id ? byId.get(prompt.essay_id) : undefined}
      key={prompt.key}
      note={note}
      prompt={prompt}
    />
  );
  return (
    <div className="divide-y divide-(--hairline)">
      {supplements.status === "none" ? (
        <p className="pb-4 text-sm text-muted-foreground">
          This school asks for no supplemental essays this year.
        </p>
      ) : null}
      {plan.required.length > 0 ? (
        <Section title="Every applicant writes">
          {plan.required.map((prompt) => row(prompt))}
        </Section>
      ) : null}
      {plan.choices.map((choice) => (
        <Section key={choice.label} title={choiceSummary(choice)}>
          {choice.options.map((prompt) => row(prompt))}
        </Section>
      ))}
      {plan.optional.length > 0 ? (
        <Section title="Optional">{plan.optional.map((prompt) => row(prompt))}</Section>
      ) : null}
      {plan.conditional.length > 0 ? (
        <Section title="For some applicants">
          {plan.conditional.map((prompt) => row(prompt, prompt.applies_to))}
        </Section>
      ) : null}
      {others.length > 0 ? (
        <Section title="Your other essays">
          {others.map((essay) => (
            <li className="flex items-center justify-between gap-3 py-3" key={essay.id}>
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
            </li>
          ))}
        </Section>
      ) : null}
      <p className="pt-3 text-xs text-muted-foreground">
        {supplementSourceLine(supplements)}
      </p>
    </div>
  );
}
