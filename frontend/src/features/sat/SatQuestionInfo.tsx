import { ExternalLink, Flag } from "lucide-react";
import type React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { SatQuestionPublic, SatTaxonomy } from "@/api/sat/types";
import { formatShortDate, shouldShowUpdated } from "@/features/sat/sat-format";
import { SAT_INFO_DIALOG_COPY, SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";

export interface SatQuestionInfoProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: SatQuestionPublic;
  taxonomy: SatTaxonomy | undefined;
  supportEmail: string | undefined;
}

function findDomainAndSkill(
  taxonomy: SatTaxonomy | undefined,
  module: string,
  domainCd: string,
  skillCd: string,
): { domainName: string; skillName: string } {
  const moduleDef = taxonomy?.modules.find((m) => m.code === module);
  const domain = moduleDef?.domains.find((d) => d.code === domainCd);
  const skill = domain?.skills.find((s) => s.code === skillCd);
  return {
    domainName: domain?.name ?? domainCd ?? SAT_PRACTICE_COPY.notAvailable,
    skillName: skill?.name ?? skillCd ?? SAT_PRACTICE_COPY.notAvailable,
  };
}

const DIFFICULTY_WORDS: Record<string, string> = {
  E: "Easy",
  M: "Medium",
  H: "Hard",
};

/** The Question Info dialog (ui-spec §4.2, Q38). */
export function SatQuestionInfo({
  open,
  onOpenChange,
  question,
  taxonomy,
  supportEmail,
}: SatQuestionInfoProps): React.ReactElement {
  const { domainName, skillName } = findDomainAndSkill(
    taxonomy,
    question.module,
    question.domain_cd,
    question.skill_cd,
  );
  const copy = SAT_INFO_DIALOG_COPY;
  const created = formatShortDate(question.cb_created_at);
  const showUpdated = shouldShowUpdated(question.cb_created_at, question.cb_updated_at);
  const updated = formatShortDate(question.cb_updated_at);

  const mailto = supportEmail
    ? `mailto:${supportEmail}?subject=${encodeURIComponent(
        `SAT practice question ${question.question_id}`,
      )}`
    : undefined;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{SAT_PRACTICE_COPY.tools.info}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[var(--ink-secondary)]">{copy.fields.questionId}</dt>
          <dd className="flex items-center gap-2 font-mono">
            {question.question_id}
            <a
              className="inline-flex items-center gap-1 text-[var(--brand)] underline"
              href={`https://www.google.com/search?q=%22${encodeURIComponent(
                question.question_id,
              )}%22+sat+tutorial&tbm=vid`}
              rel="noreferrer"
              target="_blank"
            >
              {copy.fields.searchTutorial}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </dd>

          <dt className="text-[var(--ink-secondary)]">{copy.fields.section}</dt>
          <dd>
            {SAT_PRACTICE_COPY.sectionLabel[question.module] ?? question.module}
          </dd>

          <dt className="text-[var(--ink-secondary)]">{copy.fields.domain}</dt>
          <dd>{domainName}</dd>

          <dt className="text-[var(--ink-secondary)]">{copy.fields.skill}</dt>
          <dd>{skillName}</dd>

          <dt className="text-[var(--ink-secondary)]">{copy.fields.scoreBand}</dt>
          <dd>{question.score_band} / 7</dd>

          <dt className="text-[var(--ink-secondary)]">{copy.fields.difficulty}</dt>
          <dd>{DIFFICULTY_WORDS[question.difficulty] ?? question.difficulty}</dd>

          <dt className="text-[var(--ink-secondary)]">{copy.fields.itemType}</dt>
          <dd>{question.item_type === "mcq" ? "Multiple choice" : "Student-produced response"}</dd>

          <dt className="text-[var(--ink-secondary)]">{copy.fields.created}</dt>
          <dd>{created ?? SAT_PRACTICE_COPY.notAvailable}</dd>

          {showUpdated && (
            <>
              <dt className="text-[var(--ink-secondary)]">{copy.fields.updated}</dt>
              <dd>{updated ?? SAT_PRACTICE_COPY.notAvailable}</dd>
            </>
          )}
        </dl>
        <DialogFooter>
          <Button render={<a href={mailto} />} variant="outline">
            <Flag aria-hidden="true" className="size-4" />
            {copy.reportIssue}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
