import {
  ArrowUpRight,
  CalendarDays,
  CalendarPlus,
  MessageCircle,
  Star,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { ScholarshipView } from "@/api/scholarships/types";
import { Button } from "@/components/ui/button";
import type { CriterionResult } from "@/features/scholarships/eligibility";
import { StatusDot } from "@/features/scholarships/FitMark";
import { SponsorLogo } from "@/features/scholarships/SponsorLogo";
import {
  awardCadence,
  awardHeadline,
  awardTotal,
  daysSince,
  daysUntil,
  deadlineTone,
  formatLongDate,
  formatShortDate,
  isNotYetOpen,
  isStale,
  relativeDays,
} from "@/features/scholarships/scholarship-format";
import { cn } from "@/lib/utils";

export type DetailActions = {
  isSaved: boolean;
  onToggleSave: () => void;
  onAddToTasks: () => void;
  onAsk: () => void;
  isAddingToTasks?: boolean;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--hairline)] px-5 py-4">
      <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">{title}</h3>
      {children}
    </section>
  );
}

function DeadlineLine({ scholarship }: { scholarship: ScholarshipView }) {
  const { deadline } = scholarship;
  const tone = deadlineTone(deadline);
  let text: string;
  if (deadline.kind === "fixed" && !deadline.date) {
    text = "Deadline not set";
  } else if (tone === "rolling" || !deadline.date) {
    text = "Rolling deadline";
  } else if (tone === "closed") {
    text = `Closed ${formatLongDate(deadline.date)}${deadline.recurs_annually ? " · reopens yearly" : ""}`;
  } else {
    text = `Due ${formatLongDate(deadline.date)} · ${relativeDays(daysUntil(deadline.date))}`;
  }
  const opens = isNotYetOpen(deadline) && deadline.opens_on;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div
        className={cn(
          "flex items-center gap-2",
          tone === "soon" && "font-medium text-[var(--scholarship-soon-ink)]",
          tone === "closed" && "text-[var(--ink-muted)]",
          (tone === "open" || tone === "rolling") && "text-[var(--ink-secondary)]",
        )}
      >
        <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
        <span>{text}</span>
      </div>
      {opens ? (
        <div className="pl-6 text-xs text-[var(--ink-muted)]">Applications open {formatShortDate(opens)}</div>
      ) : null}
    </div>
  );
}

function Criteria({ criteria, linkProfile }: { criteria: CriterionResult[]; linkProfile: boolean }) {
  if (criteria.length === 0) {
    return <p className="text-sm text-[var(--ink-secondary)]">No rules listed. Check the sponsor's site.</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
        {criteria.map((criterion) => (
          <li className="flex gap-2.5" key={criterion.key}>
            <StatusDot className="mt-px" status={criterion.status} />
            <div className="min-w-0">
              <div className="text-sm text-[var(--ink)]">
                <span className="sr-only">
                  {criterion.status === "met" ? "Met: " : criterion.status === "unmet" ? "Not met: " : "Unknown: "}
                </span>
                {criterion.label}
              </div>
              {criterion.status === "met" ? null : (
                <div className="text-xs text-[var(--ink-muted)]">
                  {criterion.profileField && linkProfile ? (
                  <Link
                    className="underline decoration-[var(--edge-strong)] underline-offset-2 hover:text-[var(--ink-secondary)]"
                    to="/app/profile"
                  >
                    {criterion.detail}
                  </Link>
                ) : (
                  criterion.detail
                )}
                </div>
              )}
            </div>
          </li>
        ))}
    </ul>
  );
}

function Submissions({ scholarship }: { scholarship: ScholarshipView }) {
  const { requirements } = scholarship;
  const extras = [
    requirements.recommendations > 0 &&
      `${requirements.recommendations} recommendation letter${requirements.recommendations === 1 ? "" : "s"}`,
    requirements.transcript && "Transcript",
    requirements.financial_documents && "Financial documents",
    requirements.interview && "Interview if selected",
  ].filter(Boolean) as string[];

  if (requirements.essays.length === 0 && extras.length === 0) {
    return <p className="text-sm text-[var(--ink-secondary)]">Application form only</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {requirements.essays.map((essay, index) => (
        <li className="flex flex-col gap-0.5" key={index}>
          <span className="text-[var(--ink)]">
            Essay{requirements.essays.length > 1 ? ` ${index + 1}` : ""}
            <span className="text-[var(--ink-muted)]">
              {essay.words ? ` · ${essay.words} words` : ""}
            </span>
          </span>
          {essay.prompt ? <span className="text-[var(--ink-secondary)]">{essay.prompt}</span> : null}
        </li>
      ))}
      {extras.map((extra) => (
        <li className="text-[var(--ink)]" key={extra}>
          {extra}
        </li>
      ))}
    </ul>
  );
}

function Facts({ scholarship }: { scholarship: ScholarshipView }) {
  const { award, basis, fields } = scholarship;
  const rows: [string, string][] = [
    ["Based on", basis.length === 0 ? "Drawing or contest" : basis.map((b) => (b === "merit" ? "Merit" : "Financial need")).join(" and ")],
    ...(award.awards_count === null ? [] : [["Awards", award.awards_count.toLocaleString("en-US")] as [string, string]]),
    ["Field of study", fields.length === 0 ? "Any" : fields.join(", ")],
  ];
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      {rows.map(([term, value]) => (
        <div className="contents" key={term}>
          <dt className="text-[var(--ink-muted)]">{term}</dt>
          <dd className="text-[var(--ink)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Only an out-of-date record says anything here. */
function StaleNotice({ scholarship }: { scholarship: ScholarshipView }) {
  if (!isStale(scholarship)) return null;
  const days = daysSince(scholarship.last_checked_on);
  return (
    <footer className="flex items-start gap-2 rounded-b-[11px] border-t border-[var(--hairline)] bg-[var(--warning-surface)] px-5 py-3.5 text-xs text-[var(--warning-fg)]">
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <p>
        {days === null ? "Never checked" : `Last checked ${days} days ago`} — confirm with the sponsor
      </p>
    </footer>
  );
}

function ActionRow({ scholarship, actions }: { scholarship: ScholarshipView; actions: DetailActions }) {
  const closed = deadlineTone(scholarship.deadline) === "closed";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          className="min-w-0 flex-1 sm:flex-none"
          disabled={!scholarship.apply_url}
          render={<a href={scholarship.apply_url || undefined} rel="noreferrer" target="_blank" />}
          size="sm"
          variant={closed ? "outline" : "default"}
        >
          {closed ? "Sponsor's site" : "Apply on sponsor's site"}
          <ArrowUpRight aria-hidden="true" />
        </Button>
        <Button
          aria-label={actions.isSaved ? "Remove from saved" : "Save scholarship"}
          aria-pressed={actions.isSaved}
          className="active:scale-[0.96]"
          onClick={actions.onToggleSave}
          size="icon-sm"
          title={actions.isSaved ? "Saved — press S to remove" : "Save — press S"}
          variant="outline"
        >
          <Star
            className={cn(
              "transition-[fill,color] duration-150",
              actions.isSaved ? "fill-[var(--ink)] text-[var(--ink)]" : "fill-transparent",
            )}
          />
        </Button>
      </div>
      <div className="-ms-2.5 flex flex-wrap items-center">
        {closed || !scholarship.deadline.date ? null : (
          <Button loading={actions.isAddingToTasks} onClick={actions.onAddToTasks} size="sm" variant="ghost">
            <CalendarPlus aria-hidden="true" />
            Add deadline to Tasks
          </Button>
        )}
        <Button onClick={actions.onAsk} size="sm" variant="ghost">
          <MessageCircle aria-hidden="true" />
          Ask Counselle
        </Button>
      </div>
    </div>
  );
}

/**
 * The scholarship as a student reads it. The admin editor renders this same
 * component as its live preview, so what an admin sees is what ships.
 */
export function ScholarshipDetail({
  scholarship,
  criteria,
  actions,
  linkProfile = true,
  className,
}: {
  scholarship: ScholarshipView;
  criteria: CriterionResult[];
  /** Omitted in the admin preview, where the buttons would do nothing. */
  actions?: DetailActions;
  linkProfile?: boolean;
  className?: string;
}) {
  const total = awardTotal(scholarship.award);
  const cadence = awardCadence(scholarship.award);
  const awardNote = [cadence === "one-time" ? null : cadence, total].filter(Boolean).join(" · ");
  const sponsor = scholarship.sponsor.trim();
  const showSponsor = !sponsor || !scholarship.name.toLowerCase().includes(sponsor.toLowerCase());
  return (
    <article
      aria-label={scholarship.name || "Untitled scholarship"}
      className={cn(
        "flex flex-col rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] shadow-[var(--elevation-1)]",
        className,
      )}
    >
      <header className="flex flex-col gap-4 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <SponsorLogo scholarship={scholarship} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            {showSponsor ? (
              <p className="truncate text-xs text-[var(--ink-muted)]">{sponsor || "Sponsor not set"}</p>
            ) : null}
            <h2 className="text-lg leading-snug font-semibold tracking-[-0.01em] text-balance text-[var(--ink)]">
              {scholarship.name || "Untitled scholarship"}
            </h2>
          </div>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums text-[var(--scholarship-amount-ink)]">
            {awardHeadline(scholarship.award)}
          </span>
          {awardNote ? <span className="text-sm text-[var(--ink-muted)]">{awardNote}</span> : null}
        </div>
        <DeadlineLine scholarship={scholarship} />
        {actions ? <ActionRow actions={actions} scholarship={scholarship} /> : null}
        {scholarship.summary ? (
          <p className="text-sm leading-relaxed text-pretty text-[var(--ink-secondary)]">{scholarship.summary}</p>
        ) : null}
      </header>
      <Section title="Who can apply">
        <Criteria criteria={criteria} linkProfile={linkProfile} />
      </Section>
      <Section title="What you'll submit">
        <Submissions scholarship={scholarship} />
      </Section>
      <Section title="About the award">
        <Facts scholarship={scholarship} />
      </Section>
      <StaleNotice scholarship={scholarship} />
    </article>
  );
}
