import { ArrowRightIcon, ChevronLeftIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { PROFILE_ANSWER_GRID_CLASS } from "@/features/profile/ProfileFieldLabel";
import {
  type FieldPlacement,
  layoutRows,
} from "@/features/profile/profile-field-layout";
import { ProfileObjectListField } from "@/features/profile/ProfileObjectListField";
import { ProfileQuestionMark } from "@/features/profile/ProfileQuestionMark";
import { ProfileScalarField } from "@/features/profile/ProfileScalarField";
import { ProfileScoreTiles } from "@/features/profile/ProfileScoreTiles";
import { hasAnyValue } from "@/features/profile/profile-facts";
import type {
  FieldConfig,
  FieldGroupConfig,
  SectionConfig,
} from "@/features/profile/profile-field-types";
import { profileSheetClass } from "@/features/profile/profile-control-styles";
import { getAtPath } from "@/features/profile/profile-patch";
import { PROFILE_NOTE_FIELD } from "@/features/profile/profile-sections-config";
import { crossFieldValidator } from "@/features/profile/profile-validators";
import { cn } from "@/lib/utils";

type CommitField = (path: string[], value: unknown) => void;

/** A field and the full path from the profile root it commits to. Object
 * fields are flattened into their children here: the question already
 * names them, so a nested legend would say the same thing twice. */
type FieldSlot = { field: FieldConfig; path: string[] };

function groupSlots(group: FieldGroupConfig, sectionKey: string): FieldSlot[] {
  return group.fields.flatMap((field) => {
    if (field.kind !== "object") {
      return [{ field, path: [sectionKey, field.key] }];
    }
    return field.fields
      .filter(
        (child) => child.kind !== "object" && child.kind !== "object-list",
      )
      .map((child) => ({
        field: child,
        path: [sectionKey, field.key, child.key],
      }));
  });
}

/** A question counts as answered once anything under it is saved. It is a
 * state, never a score: the header counts questions, not fields, so a long
 * question is not worth more than a short one. */
function isAnswered(group: FieldGroupConfig, value: unknown): boolean {
  return group.fields.some((field) =>
    hasAnyValue(getAtPath(value, [field.key])),
  );
}

/** One profile section (Basics, Academics, ...) as a run of plain questions,
 * each with the fields that answer it, then the way on to the next section. */
export function ProfileSectionCard({
  groupLabel,
  nextSection,
  onFieldCommit,
  onSelect,
  previousSection,
  section,
  value,
}: {
  groupLabel: string;
  nextSection?: SectionConfig;
  onFieldCommit: CommitField;
  onSelect: (key: string) => void;
  previousSection?: SectionConfig;
  section: SectionConfig;
  value: unknown;
}) {
  const answered = section.groups.map((group) => isAnswered(group, value));

  return (
    <div className={cn("w-full overflow-hidden", profileSheetClass)}>
      <SectionHeading
        answered={answered}
        groupLabel={groupLabel}
        section={section}
      />
      <div className="flex flex-col">
        {section.groups.map((group, index) => (
          <Question
            answered={answered[index]}
            group={group}
            key={group.label}
            onFieldCommit={onFieldCommit}
            section={section}
            value={value}
          />
        ))}
      </div>
      <SectionNote
        onFieldCommit={onFieldCommit}
        sectionKey={section.key}
        value={getAtPath(value, [PROFILE_NOTE_FIELD.key])}
      />
      <SectionPager
        nextSection={nextSection}
        onSelect={onSelect}
        previousSection={previousSection}
      />
    </div>
  );
}

/** The section's name, what it is for, and how many of its questions have
 * an answer — a meter with one segment per question, and the same count in
 * words so the state never rests on colour. */
function SectionHeading({
  answered,
  groupLabel,
  section,
}: {
  answered: readonly boolean[];
  groupLabel: string;
  section: SectionConfig;
}) {
  const count = answered.filter(Boolean).length;

  return (
    <header className="flex flex-col gap-5 border-b border-[var(--profile-section-divider)] bg-[linear-gradient(to_bottom,var(--brand-subtle),transparent)] px-6 pt-7 pb-6 sm:flex-row sm:items-end sm:justify-between md:px-10 md:pt-9 md:pb-7">
      <div className="flex max-w-prose flex-col gap-1.5">
        {/* The rail names the group on desktop; stacked on a phone, the
         * rail scrolls away, so the sheet says it. */}
        <p className="text-xs text-[var(--ink-faint)] md:hidden">
          {groupLabel}
        </p>
        <h2 className="text-[1.375rem] leading-7 font-semibold tracking-[-0.01em] text-balance text-[var(--ink)]">
          {section.title}
        </h2>
        <p className="text-sm leading-6 text-pretty text-[var(--ink-secondary)]">
          {section.description}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
        <div aria-hidden="true" className="flex gap-1">
          {answered.map((isOn, index) => (
            <span
              className={cn(
                "h-1 w-6 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
                isOn
                  ? "bg-[var(--progress-fill)]"
                  : "bg-[color-mix(in_oklch,var(--edge-control)_45%,transparent)]",
              )}
              key={index}
            />
          ))}
        </div>
        <p
          aria-live="polite"
          className="text-xs text-[var(--ink-faint)] tabular-nums"
        >
          {count} of {answered.length} answered
        </p>
      </div>
    </header>
  );
}

/** One question: asked on the left in the reader's voice, answered on the
 * right. The question is set in the document serif because it is the one
 * line on the page addressed to the student rather than labelling a box. */
function Question({
  answered,
  group,
  onFieldCommit,
  section,
  value,
}: {
  answered: boolean;
  group: FieldGroupConfig;
  onFieldCommit: CommitField;
  section: SectionConfig;
  value: unknown;
}) {
  const headingId = useId();
  const slots = groupSlots(group, section.key);
  const placements = layoutRows(slots.map((slot) => slot.field));
  const isSingle = slots.length === 1;

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-x-10 gap-y-5 border-t border-[var(--profile-section-divider)] px-6 py-7 first:border-t-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:px-10 md:py-9"
    >
      <div className="flex flex-col items-start">
        <h3
          className="font-document text-[1.4375rem] leading-[1.25] font-normal tracking-[-0.01em] text-balance text-[var(--ink)]"
          id={headingId}
        >
          {group.question}
        </h3>
        {group.why ? (
          <p className="mt-2.5 text-chrome text-pretty text-[var(--ink-faint)]">
            {group.why}
          </p>
        ) : null}
        <ProfileQuestionMark answered={answered} className="mt-3.5" />
      </div>
      <div className={PROFILE_ANSWER_GRID_CLASS}>
        {group.layout === "tiles" ? (
          <ProfileScoreTiles
            fields={group.fields}
            onFieldCommit={onFieldCommit}
            path={[section.key]}
            value={value}
          />
        ) : (
          slots.map((slot, index) => (
            <SectionField
              hideLabel={isSingle}
              key={slot.path.join(".")}
              groupLabel={group.label}
              onFieldCommit={onFieldCommit}
              slot={slot}
              value={value}
              placement={placements[index]}
            />
          ))
        )}
      </div>
    </section>
  );
}

function SectionField({
  groupLabel,
  hideLabel,
  onFieldCommit,
  slot,
  placement,
  value,
}: {
  groupLabel: string;
  hideLabel: boolean;
  onFieldCommit: CommitField;
  slot: FieldSlot;
  value: unknown;
  placement: FieldPlacement;
}) {
  const fieldValue = getAtPath(value, slot.path.slice(1));

  if (slot.field.kind === "object-list") {
    return (
      <div className="col-span-2 sm:col-span-6">
        <ProfileObjectListField
          config={slot.field}
          onCommit={(nextValue) => onFieldCommit(slot.path, nextValue)}
          showLabel={slot.field.label !== groupLabel}
          value={fieldValue}
        />
      </div>
    );
  }

  // Objects never reach here — `groupSlots` flattens them into their leaves.
  if (slot.field.kind === "object") {
    return null;
  }

  return (
    <ProfileScalarField
      config={slot.field}
      hideLabel={hideLabel}
      placement={placement}
      onCommit={(nextValue) => onFieldCommit(slot.path, nextValue)}
      validate={crossFieldValidator(slot.path, value)}
      value={fieldValue}
    />
  );
}

/** Every section ends in the same free-text note. It is always the last
 * thing filled and, left open, the largest control on the sheet, so it
 * opens on request; the autosave contract sits beside it. */
function SectionNote({
  onFieldCommit,
  sectionKey,
  value,
}: {
  onFieldCommit: CommitField;
  sectionKey: string;
  value: unknown;
}) {
  const [isOpen, setIsOpen] = useState(
    typeof value === "string" && value.trim() !== "",
  );

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--profile-section-divider)] px-6 py-5 md:px-10">
      {isOpen ? (
        <div className={PROFILE_ANSWER_GRID_CLASS}>
          <ProfileScalarField
            config={PROFILE_NOTE_FIELD}
            onCommit={(nextValue) =>
              onFieldCommit([sectionKey, PROFILE_NOTE_FIELD.key], nextValue)
            }
            value={value}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isOpen ? (
          <span />
        ) : (
          <Button
            className="-ml-2.5 text-[var(--ink-secondary)]"
            onClick={() => setIsOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon />
            Anything else? Add a note
          </Button>
        )}
        <span className="text-xs text-[var(--ink-faint)]">
          Saves when you click away.
        </span>
      </div>
    </div>
  );
}

function SectionPager({
  nextSection,
  onSelect,
  previousSection,
}: {
  nextSection?: SectionConfig;
  onSelect: (key: string) => void;
  previousSection?: SectionConfig;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--profile-section-divider)] bg-[var(--canvas-hover)] px-4 py-3 md:px-8">
      {previousSection ? (
        <Button
          className="text-[var(--ink-secondary)]"
          onClick={() => onSelect(previousSection.key)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronLeftIcon />
          {previousSection.title}
        </Button>
      ) : (
        <span />
      )}
      {nextSection ? (
        <Button onClick={() => onSelect(nextSection.key)} type="button">
          Next: {nextSection.title}
          <ArrowRightIcon />
        </Button>
      ) : null}
    </div>
  );
}
