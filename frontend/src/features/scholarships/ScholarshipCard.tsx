import { Bookmark } from "lucide-react";
import type { CSSProperties } from "react";

import type { ScholarshipView } from "@/api/scholarships/types";
import { cn } from "@/lib/utils";
import type { Fit } from "./eligibility";
import { SponsorLogo } from "./SponsorLogo";
import { sponsorColour } from "./sponsor-colours";
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
        {label}
      </span>
    </div>
  );
}

function deadlineFigure(deadline: ScholarshipView["deadline"]) {
  if (deadline.kind === "rolling") {
    return { value: "Rolling", label: "apply any time" };
  }
  if (!deadline.date) return { value: null, label: "deadline" };
  const value = formatShortDate(deadline.date);
  if (deadlineTone(deadline) === "closed") {
    return { value, label: "closed this cycle" };
  }
  if (isNotYetOpen(deadline) && deadline.opens_on) {
    return { value, label: `opens ${formatShortDate(deadline.opens_on)}` };
  }
  return { value, label: `due ${relativeDays(daysUntil(deadline.date))}` };
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
  const colour = sponsorColour(scholarship);
  return (
    <li
      className="scholarship-card"
      data-scholarship-id={scholarship.id}
      data-selected={isSelected || undefined}
      style={
        colour
          ? ({
              "--scholarship-sponsor-colour": colour.fill,
              "--scholarship-sponsor-colour-ink": colour.ink,
            } as CSSProperties)
          : undefined
      }
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
            {isSaved ? "Saved" : "Save"}
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
        <p className="scholarship-card-sponsor">{scholarship.sponsor}</p>
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
              deadlineTone(scholarship.deadline) === "soon"
                ? "scholarship-card-label-soon"
                : undefined
            }
            value={deadline.value}
          />
        </div>
      </div>
    </li>
  );
}
