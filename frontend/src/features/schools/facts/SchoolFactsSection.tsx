import { AbsentGroup } from "@/features/schools/facts/AbsentRow";
import {
  CollapsibleFactGroup,
  FactGroup,
  FactGroupAccordion,
} from "@/features/schools/facts/FactGroup";
import { DerivedFactRow, FactRow } from "@/features/schools/facts/FactRow";
import {
  ApplyingLanes,
  RoundsTable,
} from "@/features/schools/facts/RoundsTable";
import {
  configuredRefs,
  OTHER_GROUP_TITLE,
  type FactEntry,
  type GroupConfig,
  type SectionConfig,
} from "@/features/schools/facts/school-facts-sections";
import {
  groupNeedsAttention,
  sectionBannerVariants,
} from "@/features/schools/facts/school-facts-format";
import type {
  DerivedFact,
  Fact,
  SchoolFacts,
} from "@/features/schools/facts/school-facts-types";
import {
  EditionBanner,
  SectionHeader,
} from "@/features/schools/facts/SectionHeader";
import { ShareBarList } from "@/features/schools/facts/ShareBar";

/*
 * One section of the About tab: headline group (open) → detail groups
 * (collapsed) → the absent group (never collapses).
 *
 * The renderer is driven by config but never trusts it as an inventory. It
 * resolves the config's refs against the packet, then sweeps up every packet
 * ref the config did not place into "Other published values" — so a manifest
 * bump adds metrics to the page instead of quietly dropping them.
 */

type Resolved = { facts: Fact[]; derived: DerivedFact[]; count: number };

function resolve(entries: readonly FactEntry[], data: SchoolFacts): Resolved {
  const facts: Fact[] = [];
  const derived: DerivedFact[] = [];
  for (const entry of entries) {
    if (entry.kind === "fact") {
      const found = data.facts[entry.ref];
      if (found) facts.push(found);
    } else {
      const found = data.derived[entry.key];
      if (found) derived.push(found);
    }
  }
  return { facts, derived, count: facts.length + derived.length };
}

function Rows({
  data,
  entries,
}: {
  data: SchoolFacts;
  entries: readonly FactEntry[];
}) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === "derived") {
          const derived = data.derived[entry.key];
          if (!derived) return null;
          return (
            <DerivedFactRow
              caveats={data.caveats}
              derived={derived}
              edition={data.edition}
              key={entry.key}
            />
          );
        }
        const fact = data.facts[entry.ref];
        if (!fact) return null;
        return (
          <FactRow
            caveats={data.caveats}
            edition={data.edition}
            fact={fact}
            key={entry.ref}
          />
        );
      })}
    </>
  );
}

/**
 * `open_admission_all_students` being true resets the entire frame — this
 * school is not selective, and every selectivity figure below should be read
 * that way. So it is hoisted to the very top rather than left in ref order.
 */
function orderHeadline(
  entries: readonly FactEntry[],
  data: SchoolFacts,
): FactEntry[] {
  const openAdmission = data.facts["admissions.open_admission_all_students"];
  const isOpen =
    openAdmission?.state.kind === "reported" &&
    openAdmission.state.raw === true;
  const present = entries.filter((entry) =>
    entry.kind === "fact"
      ? Boolean(data.facts[entry.ref])
      : Boolean(data.derived[entry.key]),
  );
  if (isOpen) return present;
  /* When it is false it is a non-event, and a non-event does not belong in
   * a headline that has seven things to say. */
  return present.filter(
    (entry) =>
      !(
        entry.kind === "fact" &&
        entry.ref === "admissions.open_admission_all_students"
      ),
  );
}

export function SchoolFactsSection({
  data,
  section,
}: {
  data: SchoolFacts;
  section: SectionConfig;
}) {
  const coverage = data.coverage[section.id];
  const headline = orderHeadline(section.headline, data);
  /* Section-scoped only. The edition-wide flags — stale, definition changed —
   * are stated once by the panel, above all six sections. */
  const banners = sectionBannerVariants(coverage);
  const absent = data.absent.filter((topic) => topic.section === section.id);
  const isApplying = section.id === "applying";
  const noPacket = coverage?.packet === "missing";

  return (
    <section
      aria-labelledby={`section-${section.id}`}
      className="@container flex flex-col gap-5"
    >
      <SectionHeader
        coverage={coverage}
        edition={data.edition}
        id={`section-${section.id}`}
        title={section.title}
      />

      {/* An honesty flag is never hidden behind a disclosure, so the banners
       * sit above the first group rather than inside one. */}
      {!noPacket && data.edition
        ? banners.map((variant) => (
            <EditionBanner
              edition={data.edition!}
              key={variant}
              schoolName={data.identity.name}
              variant={variant}
            />
          ))
        : null}

      {noPacket ? <NoPacketNote data={data} title={section.title} /> : null}

      {isApplying ? (
        <ApplyingHeadline data={data} />
      ) : headline.length > 0 ? (
        <FactGroup caveat={section.headlineCaveat}>
          <Rows data={data} entries={headline} />
        </FactGroup>
      ) : null}

      <DetailGroups data={data} section={section} />

      <AbsentGroup identity={data.identity} topics={absent} />
    </section>
  );
}

function ApplyingHeadline({ data }: { data: SchoolFacts }) {
  return (
    <div className="flex flex-col gap-5">
      <RoundsTable
        caveats={data.caveats}
        edition={data.edition}
        rounds={data.rounds}
      />
      <ApplyingLanes
        caveats={data.caveats}
        edition={data.edition}
        rows={data.applyingLanes}
      />
    </div>
  );
}

function DetailGroups({
  data,
  section,
}: {
  data: SchoolFacts;
  section: SectionConfig;
}) {
  const placed = configuredRefs(section);
  const groups = section.groups
    .map((group) => ({ group, resolved: resolve(group.entries, data) }))
    .filter(
      ({ group, resolved }) =>
        resolved.count > 0 ||
        (group.render === "shares" && data.degreeShares.length > 0),
    );

  /*
   * Every ref the packet returned for this section that the config did not
   * place. Without this a manifest bump would silently hide metrics — the
   * same failure mode as a blank cell, one layer up.
   */
  const stray = strayEntries(data, placed, section);

  if (groups.length === 0 && stray.length === 0) return null;

  return (
    <FactGroupAccordion>
      {groups.map(({ group, resolved }) => (
        <DetailGroup
          data={data}
          group={group}
          key={group.id}
          resolved={resolved}
        />
      ))}
      {stray.length > 0 ? (
        <CollapsibleFactGroup
          count={stray.length}
          needsAttention={false}
          title={OTHER_GROUP_TITLE}
          value="other"
        >
          <Rows data={data} entries={stray} />
        </CollapsibleFactGroup>
      ) : null}
    </FactGroupAccordion>
  );
}

function DetailGroup({
  data,
  group,
  resolved,
}: {
  data: SchoolFacts;
  group: GroupConfig;
  resolved: Resolved;
}) {
  if (group.render === "shares") {
    return (
      <CollapsibleFactGroup
        count={data.degreeShares.length}
        needsAttention={false}
        title={group.title}
        value={group.id}
      >
        <ShareBarList shares={data.degreeShares} />
      </CollapsibleFactGroup>
    );
  }
  return (
    <CollapsibleFactGroup
      caveat={group.caveat}
      count={resolved.count}
      needsAttention={groupNeedsAttention(
        [...resolved.facts, ...resolved.derived],
        data.caveats,
      )}
      title={group.title}
      value={group.id}
    >
      <Rows data={data} entries={group.entries} />
    </CollapsibleFactGroup>
  );
}

/**
 * Packet refs belonging to this section's domains that no group claimed.
 * Section ownership is inferred from the domains the config already
 * references, so a brand-new domain surfaces under the section its
 * neighbours live in rather than vanishing.
 */
function strayEntries(
  data: SchoolFacts,
  placed: Set<string>,
  section: SectionConfig,
): FactEntry[] {
  const domains = new Set(
    [...placed].map((ref) => ref.split(".")[0]).filter(Boolean),
  );
  /* Applying and Getting in share the admissions domain, so a stray
   * admissions ref would otherwise appear in both. The first section that
   * claims a domain owns its strays. */
  const owned = OWNS_DOMAIN[section.id];
  return Object.keys(data.facts)
    .filter((ref) => !placed.has(ref))
    .filter((ref) => {
      const domain = ref.split(".")[0];
      return owned ? owned.includes(domain) : domains.has(domain);
    })
    .sort()
    .map((ref) => ({ kind: "fact" as const, ref }));
}

const OWNS_DOMAIN: Partial<Record<string, string[]>> = {
  "getting-in": ["admissions", "class_profile"],
  money: ["cost", "financial_aid"],
  academics: ["academics", "class_size", "faculty", "degrees"],
  "campus-life": ["enrollment", "student_life", "identity"],
  outcomes: ["outcomes"],
  /* Applying's facts are all placed by config; it never sweeps admissions,
   * because Getting in already owns that domain. */
  applying: [],
};

function NoPacketNote({ data, title }: { data: SchoolFacts; title: string }) {
  /*
   * Two different facts wear the same empty section, and conflating them
   * would be its own small lie: "we have this school's form and this part of
   * it is not in there" is not the same claim as "we have no form for this
   * school at all".
   */
  if (!data.edition) {
    return (
      <div className="rounded-md bg-[var(--school-fact-well)] p-4">
        <p className="text-sm font-medium text-[var(--ink)]">
          Nothing to show without a Common Data Set
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--ink-secondary)]">
          Every figure in this section comes from {data.identity.name}'s Common
          Data Set, and we have not been able to read one. Applying is still
          populated, because those requirements come from the school's own pages
          rather than the form.
        </p>
      </div>
    );
  }

  const year = `${data.edition.academicYear - 1}–${String(data.edition.academicYear).slice(-2)}`;
  return (
    <div className="rounded-md bg-[var(--school-fact-well)] p-4">
      <p className="text-sm font-medium text-[var(--ink)]">
        This section isn't in the {year} edition we have
      </p>
      <p className="mt-1 text-sm leading-6 text-[var(--ink-secondary)]">
        {data.identity.name}'s {year} Common Data Set didn't include the{" "}
        {title.toLowerCase()} section, or we couldn't read it. We don't fill the
        gap from an older edition.
      </p>
    </div>
  );
}
