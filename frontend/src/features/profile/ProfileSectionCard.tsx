import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ProfileObjectListField } from "@/features/profile/ProfileObjectListField";
import { ProfileScalarField } from "@/features/profile/ProfileScalarField";
import { sectionFacts } from "@/features/profile/profile-facts";
import type {
  FieldConfig,
  FieldGroupConfig,
  SectionConfig,
} from "@/features/profile/profile-field-types";
import { getAtPath } from "@/features/profile/profile-patch";
import { PROFILE_NOTE_FIELD } from "@/features/profile/profile-sections-config";
import { cn } from "@/lib/utils";

type CommitField = (path: string[], value: unknown) => void;

/** A field and the full path from the profile root it commits to. Object
 * fields are flattened into their children here: the group label already
 * names them, so a nested legend would say the same word twice. */
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

/** Three columns of short controls is the section's rhythm; anything that
 * holds a sentence or a set takes the width it needs instead of being
 * squeezed into a third. */
function spanClass(field: FieldConfig): string {
  if (field.kind === "object-list") {
    return "md:col-span-3";
  }
  return field.kind === "textarea" ||
    field.kind === "string-list" ||
    field.kind === "multi-select"
    ? "md:col-span-2"
    : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Rank and size are only wrong relative to each other, so the check runs on
 * whichever of the pair just changed, against the committed other. */
function rankValidator(
  section: SectionConfig,
  field: FieldConfig,
  value: unknown,
) {
  if (
    section.key !== "academics" ||
    (field.key !== "class_rank" && field.key !== "class_size")
  ) {
    return undefined;
  }
  return (nextValue: unknown) => {
    const rank = finiteNumber(
      field.key === "class_rank" ? nextValue : getAtPath(value, ["class_rank"]),
    );
    const size = finiteNumber(
      field.key === "class_size" ? nextValue : getAtPath(value, ["class_size"]),
    );
    return rank !== null && size !== null && rank > size
      ? "Class rank can’t be higher than class size."
      : null;
  };
}

/** One profile section (Basics, Academics, ...) as the detail panel beside
 * the section rail: what the section is and what it currently says, then its
 * fields in labelled groups, then the way on to the next section. */
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
  return (
    <div className="w-full overflow-hidden rounded-xl border border-[var(--profile-section-border)] bg-[var(--profile-section-surface)]">
      <SectionHeading groupLabel={groupLabel} section={section} value={value} />
      <div className="flex flex-col px-6">
        {section.groups.map((group, index) => (
          <FieldGroup
            group={group}
            key={group.label}
            onFieldCommit={onFieldCommit}
            section={section}
            showDivider={index > 0}
            value={value}
          />
        ))}
        <SectionNote
          onFieldCommit={onFieldCommit}
          sectionKey={section.key}
          value={getAtPath(value, [PROFILE_NOTE_FIELD.key])}
        />
      </div>
      <SectionPager
        nextSection={nextSection}
        onSelect={onSelect}
        previousSection={previousSection}
      />
    </div>
  );
}

function SectionHeading({
  groupLabel,
  section,
  value,
}: {
  groupLabel: string;
  section: SectionConfig;
  value: unknown;
}) {
  const facts = sectionFacts(section, value);

  return (
    <header className="flex flex-col gap-2 border-b border-[var(--profile-section-divider)] px-6 py-5">
      <p className="text-xs font-medium text-[var(--profile-field-helper)]">
        {groupLabel}
      </p>
      <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        {section.description}
      </p>
      {/* Read back verbatim, or — with nothing saved yet — what the section
       * would change. Never a count, never a score.
       *
       * Each fact is its own `dir="auto"` isolate. Saved values can be
       * right-to-left (pronouns commonly are), and one RTL run in a
       * `·`-joined string reorders its neighbours around it — "Saif ·
       * طبزك · 10th" renders as "Saif · 10 · طبزك", which is the student's
       * own data shown wrong. */}
      <p className="text-sm text-[var(--profile-field-label)]">
        {facts.length > 0 ? (
          <>
            {"Right now: "}
            {facts.map((fact, index) => (
              <span key={fact}>
                {index > 0 ? " · " : null}
                <span dir="auto">{fact}</span>
              </span>
            ))}
          </>
        ) : (
          section.matters
        )}
      </p>
    </header>
  );
}

function FieldGroup({
  group,
  onFieldCommit,
  section,
  showDivider,
  value,
}: {
  group: FieldGroupConfig;
  onFieldCommit: CommitField;
  section: SectionConfig;
  showDivider: boolean;
  value: unknown;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 py-5",
        showDivider && "border-t border-[var(--profile-section-divider)]",
      )}
    >
      <h3 className="text-xs font-medium text-[var(--profile-field-helper)]">
        {group.label}
      </h3>
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-3">
        {groupSlots(group, section.key).map((slot) => (
          <div className={spanClass(slot.field)} key={slot.path.join(".")}>
            <SectionField
              onFieldCommit={onFieldCommit}
              section={section}
              slot={slot}
              value={value}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionField({
  onFieldCommit,
  section,
  slot,
  value,
}: {
  onFieldCommit: CommitField;
  section: SectionConfig;
  slot: FieldSlot;
  value: unknown;
}) {
  const fieldValue = getAtPath(value, slot.path.slice(1));

  if (slot.field.kind === "object-list") {
    return (
      <ProfileObjectListField
        config={slot.field}
        onCommit={(nextValue) => onFieldCommit(slot.path, nextValue)}
        value={fieldValue}
      />
    );
  }

  // Objects never reach here — `groupSlots` flattens them into their leaves.
  if (slot.field.kind === "object") {
    return null;
  }

  return (
    <ProfileScalarField
      config={slot.field}
      onCommit={(nextValue) => onFieldCommit(slot.path, nextValue)}
      validate={rankValidator(section, slot.field, value)}
      value={fieldValue}
    />
  );
}

/** Every section ends in the same free-text note. Left in the grid it was
 * always the largest control on the screen and always the last thing filled,
 * so it opens on request and the autosave contract sits beside it. */
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
    <div className="flex flex-col gap-4 border-t border-[var(--profile-section-divider)] py-5">
      {isOpen ? (
        <ProfileScalarField
          config={PROFILE_NOTE_FIELD}
          onCommit={(nextValue) =>
            onFieldCommit([sectionKey, PROFILE_NOTE_FIELD.key], nextValue)
          }
          value={value}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isOpen ? (
          <span />
        ) : (
          <Button
            className="-ml-2 text-[var(--profile-field-label)]"
            onClick={() => setIsOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon />
            Add a note
          </Button>
        )}
        <span className="text-xs text-[var(--profile-field-helper)]">
          Autosaves when you click away.
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
    <div className="flex items-center justify-between gap-3 border-t border-[var(--profile-section-divider)] px-4 py-3">
      {previousSection ? (
        <Button
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
        <Button
          onClick={() => onSelect(nextSection.key)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {nextSection.title}
          <ChevronRightIcon />
        </Button>
      ) : null}
    </div>
  );
}
