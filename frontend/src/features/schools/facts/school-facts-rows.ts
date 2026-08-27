import {
  DERIVED_UNAVAILABLE_COPY,
  factStateCopy,
  isReported,
  ROUND_NOT_OFFERED_COPY,
} from "@/features/schools/facts/school-facts-format";
import type {
  FactEntry,
  SectionConfig,
} from "@/features/schools/facts/school-facts-sections";
import type {
  LaneRow,
  RoundRow,
  SchoolFacts,
} from "@/features/schools/facts/school-facts-types";

/*
 * A fact, flattened to a name/value pair.
 *
 * Everything the About tab shows that is NOT plotted resolves to a row here,
 * so the table stays a dumb renderer and the one judgement that matters —
 * what string stands in for a value we do not have — is made once, in
 * `factStateCopy`. `school-facts-blocks.ts` assembles these into a section.
 *
 * `reported` is the only flag a row carries. A reported 0 is a fact and reads
 * at full weight; every other state is a sentence saying which kind of
 * nothing it is. Never a blank cell, a dash, or a hidden row.
 */

export type FactTableRow = {
  key: string;
  label: string;
  value: string;
  reported: boolean;
};

/** Below this a run is shorter than the line that would replace it. */
const COMPRESSIBLE_RUN = 3;

/**
 * A run of consecutive rows that are absent for the SAME reason collapses to
 * one row: every label still printed, the shared sentence said once.
 *
 * Yale's applicant pool is the case this exists for — four rows of the
 * in-state / out-of-state split, all "not applicable" because it is a private
 * institution, stacked into four identical sentences that out-weigh the three
 * counts above them purely by repetition.
 *
 * This is a COMPRESSION, not a hide, and the distinction is the whole design:
 * no label is dropped, no row is filtered, and the reason is on screen at full
 * size. A version of this that folded the labels behind "3 more" would be
 * hiding, because a student could no longer see WHICH metrics we have nothing
 * for. Compare `strayRefs`, which exists to stop the same silent loss one
 * layer up.
 */
export function compressAbsences(
  rows: readonly FactTableRow[],
): FactTableRow[] {
  const out: FactTableRow[] = [];
  for (let i = 0; i < rows.length; ) {
    const head = rows[i];
    let end = i + 1;
    if (!head.reported) {
      while (
        end < rows.length &&
        !rows[end].reported &&
        rows[end].value === head.value
      )
        end += 1;
    }
    const run = rows.slice(i, end);
    if (run.length < COMPRESSIBLE_RUN) {
      out.push(...run);
    } else {
      out.push({
        key: run.map((row) => row.key).join("+"),
        /* The labels are a LIST, joined with a semicolon because several of
         * them contain commas of their own. */
        label: run.map((row) => row.label).join("; "),
        value: head.value,
        reported: false,
      });
    }
    i = end;
  }
  return out;
}

export function entryRow(
  entry: FactEntry,
  data: SchoolFacts,
): FactTableRow | null {
  if (entry.kind === "derived") {
    const derived = data.derived[entry.key];
    if (!derived) return null;
    const reported = isReported(derived.state);
    return {
      key: `derived:${derived.key}`,
      label: derived.label,
      /*
       * "not available" means we tried and an input stopped us. When the
       * state is a real absence, that state's own words are the truthful
       * ones — borrowing "not available" would claim an attempt we never
       * made.
       */
      value: reported
        ? factStateCopy(derived.state)
        : derived.blockedBy
          ? DERIVED_UNAVAILABLE_COPY
          : factStateCopy(derived.state),
      reported,
    };
  }
  const fact = data.facts[entry.ref];
  if (!fact) return null;
  return {
    key: fact.ref,
    label: fact.label,
    value: factStateCopy(fact.state),
    reported: isReported(fact.state),
  };
}

/**
 * The school's own current page wins over the form when both speak, because
 * the form is a year old by the time a student reads it. Falling back to the
 * CDS keeps the row from going quiet when only the older source has an answer.
 */
export function laneRow(lane: LaneRow): FactTableRow {
  const preferred =
    lane.official && isReported(lane.official.state)
      ? lane.official.state
      : lane.cds && isReported(lane.cds.state)
        ? lane.cds.state
        : (lane.official?.state ?? lane.cds?.state ?? { kind: "not_reported" });
  return {
    key: `lane:${lane.id}`,
    label: lane.label,
    value: factStateCopy(preferred),
    reported: isReported(preferred),
  };
}

/**
 * A round the school does not offer says "not offered". A round whose
 * offered-flag we could not read says "not reported". A student who reads
 * "not offered" stops looking, so the two never collapse into one row.
 */
export function roundRows(round: RoundRow): FactTableRow[] {
  if (round.offered !== "yes") {
    return [
      {
        key: `round:${round.code}`,
        label: round.code,
        value: round.offered === "no" ? ROUND_NOT_OFFERED_COPY : "not reported",
        reported: false,
      },
    ];
  }
  const rows: FactTableRow[] = [
    { ...laneRow(round.deadline), key: `round:${round.code}:deadline` },
    {
      key: `round:${round.code}:notification`,
      label: `${round.code} decision`,
      value: factStateCopy(round.notification),
      reported: isReported(round.notification),
    },
  ];
  if (round.restrictive) {
    rows.push({
      key: `round:${round.code}:restriction`,
      label: `${round.code} restriction`,
      value: "Blocks other early applications",
      reported: true,
    });
  }
  return rows;
}

export function strayRefs(
  data: SchoolFacts,
  placed: Set<string>,
  section: SectionConfig,
): string[] {
  const domains = new Set(
    [...placed].map((ref) => ref.split(".")[0]).filter(Boolean),
  );
  /* Applying and Getting in share the admissions domain. The section that
   * claims a domain owns its strays, so a stray never renders twice. */
  const owned = OWNS_DOMAIN[section.id];
  return Object.keys(data.facts)
    .filter((ref) => !placed.has(ref))
    .filter((ref) => {
      const domain = ref.split(".")[0];
      return owned ? owned.includes(domain) : domains.has(domain);
    })
    .sort();
}

const OWNS_DOMAIN: Partial<Record<string, string[]>> = {
  "getting-in": ["admissions", "class_profile"],
  money: ["cost", "financial_aid"],
  academics: ["academics", "class_size", "faculty", "degrees"],
  "campus-life": ["enrollment", "student_life", "identity"],
  outcomes: ["outcomes"],
  /* Applying's facts are all placed by config; Getting in owns admissions. */
  applying: [],
};

/**
 * `open_admission_all_students` being true resets the frame — this school is
 * not selective, and every selectivity figure below should be read that way.
 * When it is false it is a non-event and does not earn a row at the top.
 */
export function orderHeadline(
  entries: readonly FactEntry[],
  data: SchoolFacts,
): FactEntry[] {
  const openAdmission = data.facts["admissions.open_admission_all_students"];
  const isOpen =
    openAdmission?.state.kind === "reported" &&
    openAdmission.state.raw === true;
  if (isOpen) return [...entries];
  return entries.filter(
    (entry) =>
      !(
        entry.kind === "fact" &&
        entry.ref === "admissions.open_admission_all_students"
      ),
  );
}
