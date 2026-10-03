import { Bookmark, Check, ChevronRight, FileText, Users } from "lucide-react";

import type { ScholarshipView } from "@/api/scholarships/types";
import type { Fit } from "./eligibility";
import { FitMark } from "./FitMark";
import { SponsorLogo } from "./SponsorLogo";
import {
  awardCadence,
  awardHeadline,
  daysUntil,
  deadlineTone,
  formatShortDate,
  isNotYetOpen,
  relativeDays,
} from "./scholarship-format";

function CardDeadline({ scholarship }: { scholarship: ScholarshipView }) {
  const { deadline } = scholarship;
  const closed = deadlineTone(deadline) === "closed";
  const rolling = deadline.kind === "rolling";
  const label = rolling
    ? "Rolling deadline"
    : closed
      ? "Deadline passed"
      : "Apply by";
  const date = rolling
    ? "Any time"
    : deadline.date
      ? formatShortDate(deadline.date)
      : "Not available";
  const note = rolling
    ? "Applications ongoing"
    : !deadline.date
      ? "Check with sponsor"
      : closed
        ? "Closed this cycle"
        : isNotYetOpen(deadline) && deadline.opens_on
          ? `Opens ${formatShortDate(deadline.opens_on)}`
          : relativeDays(daysUntil(deadline.date));
  return (
    <div
      className="scholarship-card-deadline"
      data-soon={deadlineTone(deadline) === "soon" || undefined}
    >
      <span>{label}</span>
      <strong>{date}</strong>
      <small>{note}</small>
    </div>
  );
}

function CardRequirements({ scholarship }: { scholarship: ScholarshipView }) {
  const essays = scholarship.requirements.essays.length;
  const recommendations = scholarship.requirements.recommendations;
  return (
    <div className="scholarship-card-requirements">
      <span>
        {essays ? (
          <FileText aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        {essays ? `${essays} ${essays === 1 ? "essay" : "essays"}` : "No essay"}
      </span>
      <span>
        <Users aria-hidden="true" />
        {recommendations
          ? `${recommendations} ${recommendations === 1 ? "recommendation" : "recommendations"}`
          : "No recommendations"}
      </span>
    </div>
  );
}

export function ScholarshipCard({
  scholarship,
  fit,
  isSaved,
  isSelected = false,
  onSelect,
  onToggleSave,
}: {
  scholarship: ScholarshipView;
  fit?: Fit;
  isSaved: boolean;
  isSelected?: boolean;
  onSelect: (opener: HTMLButtonElement) => void;
  onToggleSave: () => void;
}) {
  return (
    <li
      className="scholarship-card"
      data-scholarship-id={scholarship.id}
      data-selected={isSelected || undefined}
    >
      <div className="scholarship-card-sponsor">
        <SponsorLogo scholarship={scholarship} size="lg" />
        <span>{scholarship.sponsor}</span>
      </div>
      <h3 className="scholarship-card-title">
        <button
          type="button"
          data-scholarship-open
          aria-haspopup="dialog"
          onClick={(event) => onSelect(event.currentTarget)}
        >
          {scholarship.name}
          <ChevronRight aria-hidden="true" size={17} strokeWidth={1.5} />
        </button>
      </h3>
      <button
        type="button"
        className="scholarship-card-save"
        aria-label={`Save ${scholarship.name}`}
        aria-pressed={isSaved}
        onClick={onToggleSave}
        title={isSaved ? "Remove from saved" : "Save scholarship"}
      >
        <Bookmark
          aria-hidden="true"
          size={17}
          strokeWidth={1.5}
          fill={isSaved ? "currentColor" : "none"}
        />
      </button>
      {scholarship.summary ? (
        <p className="scholarship-card-summary">{scholarship.summary}</p>
      ) : null}
      <div className="scholarship-card-figures">
        <div className="scholarship-card-award">
          <span>Scholarship award</span>
          <strong>{awardHeadline(scholarship.award)}</strong>
          <small>{awardCadence(scholarship.award)}</small>
        </div>
        <CardDeadline scholarship={scholarship} />
      </div>
      <div className="scholarship-card-footer">
        <CardRequirements scholarship={scholarship} />
        {fit ? <FitMark fit={fit} /> : null}
      </div>
    </li>
  );
}
