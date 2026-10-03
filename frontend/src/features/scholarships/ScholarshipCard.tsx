import { Bookmark } from "lucide-react";
import type { CSSProperties } from "react";

import type { ScholarshipView } from "@/api/scholarships/types";
import { cn } from "@/lib/utils";
import type { Fit } from "./eligibility";
import { SponsorLogo } from "./SponsorLogo";
import { isKnownLogoless, sponsorColour } from "./sponsor-colours";
import { sponsorMark } from "./sponsor-mark";
import {
  awardCadence,
  awardHeadline,
  daysUntil,
  deadlineTone,
  formatShortDate,
  isNotYetOpen,
  relativeDays,
} from "./scholarship-format";

/*
 * One scholarship, drawn on the Explore school card's anatomy so the two
 * catalogs read as one product: logo chip and actions on top, the name and
 * sponsor, then two figures split by a hairline. The card carries only what a
 * student decides on first, how much and by when; essays, eligibility and the
 * description are one click away in the detail sheet. A missing date
 * still takes its slot and says "not available"; a blank would read as open.
 */

const ABSENT = "not available";

function Figure({
  value,
  label,
  valueClassName,
  labelClassName,
}: {
  value: string | null;
  label: string;
  valueClassName?: string;
  labelClassName?: string;
}) {
  return (
    <div className="min-w-0">
      {value === null ? (
        <span className="scholarship-card-absent">{ABSENT}</span>
      ) : (
        <span className={cn("scholarship-card-value", valueClassName)}>{value}</span>
      )}
      <span className={cn("scholarship-card-label", labelClassName)}>
        {label || "\u00a0"}
      </span>
    </div>
  );
}

function deadlineFigure(deadline: ScholarshipView["deadline"]) {
  if (deadline.kind === "rolling") {
    return { value: "Rolling", label: "apply any time", soon: false };
  }
  if (!deadline.date) return { value: null, label: "deadline", soon: false };
  const value = formatShortDate(deadline.date);
  if (deadlineTone(deadline) === "closed") {
    return { value, label: "closed this cycle", soon: false };
  }
  if (isNotYetOpen(deadline) && deadline.opens_on) {
    return { value, label: `opens ${formatShortDate(deadline.opens_on)}`, soon: false };
  }
  return {
    value,
    label: `due ${relativeDays(daysUntil(deadline.date))}`,
    soon: deadlineTone(deadline) === "soon",
  };
}

function FitPill({ fit }: { fit: Fit }) {
  if (fit.kind === "check") return null;
  const fits = fit.kind === "fits";
  return (
    <span
      className="scholarship-card-pill"
      data-fit={fits ? "met" : "unmet"}
      title={fits ? "Fits your profile" : fit.reason}
    >
      <span aria-hidden="true" className="scholarship-card-pill-dot" />
      {fits ? "Fits you" : "Not a fit"}
    </span>
  );
}

/**
 * The card is washed in its logo's colour, which also inks the award. A
 * sponsor with no logo shows its icon mark instead, so the card takes the
 * mark's colour for the wash only: not every mark ink clears 4.5:1 as text.
 */
function cardColour(scholarship: ScholarshipView): CSSProperties | undefined {
  const colour = sponsorColour(scholarship);
  if (colour) {
    return {
      "--scholarship-sponsor-colour": colour.fill,
      "--scholarship-sponsor-colour-ink": colour.ink,
    } as CSSProperties;
  }
  if (isKnownLogoless(scholarship)) {
    const mark = sponsorMark(scholarship.sponsor || scholarship.name);
    return { "--scholarship-sponsor-colour": mark.ink } as CSSProperties;
  }
  return undefined;
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
  const deadline = deadlineFigure(scholarship.deadline);
  return (
    <li
      className="scholarship-card"
      data-scholarship-id={scholarship.id}
      data-selected={isSelected || undefined}
      style={cardColour(scholarship)}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="scholarship-card-logo">
          <SponsorLogo
            className="size-10 rounded-lg"
            scholarship={scholarship}
            size="lg"
          />
        </span>
        <div className="flex items-center gap-1.5">
          {fit ? <FitPill fit={fit} /> : null}
          <button
            type="button"
            className="scholarship-card-save"
            aria-label={`Save ${scholarship.name}`}
            aria-pressed={isSaved}
            onClick={onToggleSave}
          >
            <Bookmark
              aria-hidden="true"
              fill={isSaved ? "currentColor" : "none"}
            />
            Save
          </button>
        </div>
      </div>

      <div className="min-w-0">
        <h3 className="scholarship-card-title">
          <button
            type="button"
            data-scholarship-open
            aria-haspopup="dialog"
            onClick={(event) => onSelect(event.currentTarget)}
          >
            {scholarship.name}
          </button>
        </h3>
        <p className="scholarship-card-sponsor" title={scholarship.sponsor}>{scholarship.sponsor}</p>
      </div>

      <div className="scholarship-card-figures">
        <Figure
          label={awardCadence(scholarship.award)}
          value={awardHeadline(scholarship.award)}
          valueClassName="scholarship-card-award"
        />
        <div className="scholarship-card-figure-split">
          <Figure
            label={deadline.label}
            labelClassName={
              deadline.soon ? "scholarship-card-label-soon" : undefined
            }
            value={deadline.value}
          />
        </div>
      </div>
    </li>
  );
}
