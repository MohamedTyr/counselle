import type {
  BandValue,
  DeadlineRow,
  DistributionBucket,
  Fact,
  MatrixRow,
  OrdinalValue,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

/*
 * Design exploration only (dev-only `?v=` on the About tab).
 *
 * The facts response is a long list of facts grouped the way CollegeData
 * publishes them. A student reads a school by question instead — can I get
 * in, can I afford it, when do I apply, will I like it, do people finish —
 * so every variant reads the same handful of facts by key from this one
 * digest rather than walking sections. A fact that is not a published value
 * is null here, and each variant decides how to say so; nothing is ever
 * drawn as zero.
 */

export type Num = { value: number; display: string; period: string | null };
export type Text = { value: string; display: string };

export type Band = {
  label: string;
  p25: number;
  p75: number;
  min: number;
  max: number;
};
export type Bucket = { label: string; pct: number };
export type Factor = { label: string; level: number; levelLabel: string };

const FACTOR_LEVEL_LABELS = [
  "Not considered",
  "Considered",
  "Important",
  "Very important",
];

function indexFacts(data: SchoolFactsResponse): Map<string, Fact> {
  const index = new Map<string, Fact>();
  for (const section of data.sections)
    for (const group of section.groups)
      for (const fact of group.facts) index.set(fact.key, fact);
  return index;
}

function reported(index: Map<string, Fact>, key: string): Fact | null {
  const fact = index.get(key);
  return fact && fact.state === "value" ? fact : null;
}

function num(index: Map<string, Fact>, key: string): Num | null {
  const fact = reported(index, key);
  if (!fact || typeof fact.value !== "number") return null;
  return {
    value: fact.value,
    display: fact.display,
    period: fact.reported_period,
  };
}

function text(index: Map<string, Fact>, key: string): Text | null {
  const fact = reported(index, key);
  if (!fact) return null;
  return {
    value: typeof fact.value === "string" ? fact.value : fact.display,
    display: fact.display,
  };
}

function list(index: Map<string, Fact>, key: string): string[] {
  const fact = reported(index, key);
  const items = (fact?.value as { items?: unknown } | null)?.items;
  return Array.isArray(items)
    ? items.filter((i): i is string => typeof i === "string")
    : [];
}

function band(
  index: Map<string, Fact>,
  key: string,
  label: string,
): Band | null {
  const fact = reported(index, key);
  const v = fact?.value as BandValue | undefined;
  if (
    !v ||
    v.p25 === null ||
    v.p75 === null ||
    v.min === null ||
    v.max === null
  )
    return null;
  return { label, p25: v.p25, p75: v.p75, min: v.min, max: v.max };
}

function buckets(index: Map<string, Fact>, key: string): Bucket[] {
  const fact = reported(index, key);
  const raw =
    (fact?.value as { buckets?: DistributionBucket[] } | undefined)?.buckets ??
    [];
  return raw
    .filter(
      (b): b is DistributionBucket & { pct: number } =>
        typeof b.pct === "number",
    )
    .map((b) => ({ label: b.label.replace(/^Score of /, ""), pct: b.pct }));
}

function matrix(index: Map<string, Fact>, key: string): MatrixRow[] {
  const fact = reported(index, key);
  return (fact?.value as { rows?: MatrixRow[] } | undefined)?.rows ?? [];
}

function link(index: Map<string, Fact>, key: string): string | null {
  const fact = reported(index, key);
  return fact && typeof fact.value === "string" && fact.value.startsWith("http")
    ? fact.value
    : null;
}

/** "Selection factor class rank" → "Class rank". */
function factorLabel(fact: Fact): string {
  const bare = fact.label
    .replace(/^Selection factor /i, "")
    .replace(/ s /g, "'s ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function factors(index: Map<string, Fact>): Factor[] {
  const out: Factor[] = [];
  for (const fact of index.values()) {
    if (
      !fact.key.startsWith("admissions.selection_factor_") ||
      fact.state !== "value"
    )
      continue;
    const v = fact.value as OrdinalValue;
    const level = v.levels.indexOf(v.code);
    if (level < 0) continue;
    out.push({
      label: factorLabel(fact),
      level,
      levelLabel: FACTOR_LEVEL_LABELS[level] ?? fact.display,
    });
  }
  return out.sort((a, b) => b.level - a.level);
}

/** A "1,127 (42.0%) of aid recipients" string → 42. */
function parentheticalPct(t: Text | null): number | null {
  const match = t?.display.match(/\(([\d.]+)%\)/);
  return match ? Number(match[1]) : null;
}

export function buildDigest(data: SchoolFactsResponse) {
  const ix = indexFacts(data);
  const deadlineRows: DeadlineRow[] = data.deadlines.rows;
  const needFullyMet = text(ix, "aid.need_fully_met_freshman");

  return {
    identity: data.identity,
    freshness: data.freshness_line,
    admissions: {
      difficulty: text(ix, "admissions.entrance_difficulty"),
      applicants: num(ix, "admissions.applicants_total"),
      admitted: num(ix, "admissions.admitted_total"),
      enrolled: num(ix, "admissions.enrolled_total"),
      rate: num(ix, "admissions.admit_rate"),
      yield: num(ix, "admissions.yield_rate"),
      rateWomen: num(ix, "admissions.admit_rate_women"),
      rateMen: num(ix, "admissions.admit_rate_men"),
      testPolicy: text(ix, "admissions.test_policy_sat_or_act"),
      essay: text(ix, "admissions.essay_requirement"),
      interview: text(ix, "admissions.interview_requirement"),
      needBlind: text(ix, "admissions.need_blind"),
      waitlistOffered: num(ix, "admissions.waitlist_offered"),
      waitlistAdmitted: num(ix, "admissions.waitlist_admitted"),
      factors: factors(ix),
    },
    scores: {
      bands: [
        band(ix, "class_profile.sat_math", "SAT Math"),
        band(ix, "class_profile.sat_ebrw", "SAT Reading & Writing"),
        band(ix, "class_profile.act_composite", "ACT Composite"),
      ].filter((b): b is Band => b !== null),
      avgGpa: num(ix, "class_profile.average_gpa"),
      gpa: buckets(ix, "class_profile.gpa_distribution"),
      topTenth: num(ix, "class_profile.class_rank_top_tenth"),
    },
    money: {
      costIn: num(ix, "costs.attendance_in_state"),
      costOut: num(ix, "costs.attendance_out_of_state"),
      tuitionIn: num(ix, "costs.tuition_fees_in_state"),
      tuitionOut: num(ix, "costs.tuition_fees_out_of_state"),
      room: num(ix, "costs.room_and_board"),
      books: num(ix, "costs.books_and_supplies"),
      other: num(ix, "costs.other_expenses"),
      avgAward: num(ix, "aid.avg_award_freshman"),
      giftAvg: num(ix, "aid.need_gift_avg_freshman"),
      needMetPct: num(ix, "aid.avg_percent_need_met_freshman"),
      fullyMetPct: parentheticalPct(needFullyMet),
      netPriceUrl: link(ix, "money.net_price_calculator_url"),
      aidUrl: link(ix, "money.financial_aid_url"),
      cssFee: text(ix, "money.css_profile_fee"),
      fafsa: text(ix, "money.fafsa_code"),
      aidNotification: text(ix, "deadlines.aid_award_notification"),
      loansPct: num(ix, "outcomes.graduates_with_loans_pct"),
      debt: num(ix, "outcomes.average_indebtedness"),
    },
    applying: {
      deadlines: deadlineRows,
      regularNotification: text(ix, "deadlines.regular_notification"),
      earlyNotification: text(ix, "deadlines.early_action_notification"),
      replyBy: text(ix, "deadlines.reply_by"),
      fee: num(ix, "applying.application_fee"),
      feeWaiver: text(ix, "applying.application_fee_waiver"),
      commonApp: text(ix, "applying.accepts_common_app"),
      email: text(ix, "applying.admissions_email"),
      units: [
        ["English", num(ix, "admissions.units_recommended_english")],
        ["Math", num(ix, "admissions.units_recommended_mathematics")],
        ["Science", num(ix, "admissions.units_recommended_science")],
        [
          "Social studies",
          num(ix, "admissions.units_recommended_social_studies"),
        ],
        [
          "Foreign language",
          num(ix, "admissions.units_recommended_foreign_language"),
        ],
      ].filter((u): u is [string, Num] => u[1] !== null),
    },
    campus: {
      undergrads: num(ix, "students.undergraduate_total"),
      womenPct: num(ix, "students.undergraduate_women_pct"),
      menPct: num(ix, "students.undergraduate_men_pct"),
      intlPct: num(ix, "students.international_pct"),
      countries: num(ix, "students.countries_represented"),
      ethnicity: buckets(ix, "students.ethnicity_distribution"),
      housingGuarantee: text(ix, "campus.freshman_housing_guarantee"),
      inHousingPct: num(ix, "campus.students_in_housing_pct"),
      cityPopulation: num(ix, "campus.city_population"),
      nearestMetro: text(ix, "campus.nearest_metro"),
      acres: num(ix, "campus.campus_acres"),
      division: text(ix, "campus.athletic_conferences"),
      mascot: text(ix, "campus.mascot"),
      varsity: matrix(ix, "campus.varsity_sports"),
      greekMen: num(ix, "campus.fraternity_participation_pct"),
      greekWomen: num(ix, "campus.sorority_participation_pct"),
      activities: list(ix, "campus.activities"),
    },
    academics: {
      majorsCount: num(ix, "academics.undergraduate_majors_count"),
      popular: list(ix, "academics.popular_disciplines"),
      classSizes: buckets(ix, "class_size.regular_distribution"),
      facultyFullTime: num(ix, "faculty.full_time_count"),
      calendar: text(ix, "academics.calendar"),
      studyAbroad: text(ix, "academics.study_abroad"),
      apPolicy: text(ix, "academics.ap_policy"),
    },
    outcomes: {
      retention: num(ix, "outcomes.retention_first_year"),
      grad4: num(ix, "outcomes.graduation_rate_4y"),
      grad5: num(ix, "outcomes.graduation_rate_5y"),
      grad6: num(ix, "outcomes.graduation_rate_6y"),
      advancedStudy: num(ix, "outcomes.advanced_study_pct"),
    },
  };
}

export type Digest = ReturnType<typeof buildDigest>;

/** "1 in 23" for a 4.3% rate — the way a person actually says odds. */
export function oneIn(
  applicants: Num | null,
  admitted: Num | null,
): string | null {
  if (!applicants || !admitted || admitted.value <= 0) return null;
  return `1 in ${Math.round(applicants.value / admitted.value)}`;
}

export function usd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Upcoming rounds with a real date, soonest first. */
export function datedRounds(
  rows: DeadlineRow[],
): (DeadlineRow & { date: string })[] {
  return rows
    .filter(
      (row): row is DeadlineRow & { date: string } =>
        row.state === "value" && row.date !== null,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function daysUntil(iso: string, today = new Date()): number {
  const target = new Date(`${iso}T12:00:00`).getTime();
  return Math.ceil((target - today.getTime()) / 86_400_000);
}
