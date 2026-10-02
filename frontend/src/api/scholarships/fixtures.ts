import type {
  Award,
  Deadline,
  Requirements,
  AdminScholarship,
} from "@/api/scholarships/types";

/*
 * Placeholder records for building the UI before the backend exists. Names
 * are modelled on well-known programs, but amounts, dates and rules are
 * illustrative, not checked facts. Dates are relative to today so the demo
 * never goes stale.
 */

function isoFromToday(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function award(partial: Partial<Award>): Award {
  return {
    kind: "fixed",
    amount: null,
    min: null,
    max: null,
    renewable: false,
    years: null,
    awards_count: null,
    ...partial,
  };
}

function due(days: number, partial: Partial<Deadline> = {}): Deadline {
  return {
    kind: "fixed",
    date: isoFromToday(days),
    opens_on: null,
    recurs_annually: true,
    ...partial,
  };
}

const ROLLING: Deadline = {
  kind: "rolling",
  date: null,
  opens_on: null,
  recurs_annually: false,
};

function needs(partial: Partial<Requirements> = {}): Requirements {
  return {
    essays: [],
    recommendations: 0,
    transcript: false,
    financial_documents: false,
    interview: false,
    ...partial,
  };
}

type Seed = Omit<
  AdminScholarship,
  "created_at" | "updated_at" | "updated_by_email" | "version" | "last_checked_on" | "status" | "other_eligibility" | "fields" | "basis" | "logo_url"
> &
  Partial<Pick<AdminScholarship, "status" | "other_eligibility" | "fields" | "basis" | "logo_url">> & {
    checkedDaysAgo?: number;
    addedDaysAgo?: number;
  };

/** A stable spread of ages so the admin list doesn't show one date everywhere. */
function spread(id: string, min: number, max: number): number {
  const hash = [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7);
  return min + (hash % (max - min + 1));
}

function record(seed: Seed): AdminScholarship {
  const { checkedDaysAgo = spread(seed.id, 2, 120), addedDaysAgo = spread(seed.id + "+", 10, 200), ...rest } = seed;
  return {
    status: "published",
    other_eligibility: [],
    fields: [],
    basis: ["merit"],
    logo_url: "",
    ...rest,
    last_checked_on: isoFromToday(-checkedDaysAgo),
    created_at: `${isoFromToday(-addedDaysAgo)}T15:00:00Z`,
    updated_at: `${isoFromToday(-Math.min(addedDaysAgo, checkedDaysAgo))}T15:00:00Z`,
    updated_by_email: "mohamed@acceptra.ai",
    version: 1,
  };
}

export const SCHOLARSHIP_FIXTURES: AdminScholarship[] = [
  record({
    id: "coca-cola-scholars",
    name: "Coca-Cola Scholars",
    sponsor: "Coca-Cola Scholars Foundation",
    summary:
      "A leadership award for seniors who have made a measurable difference in their school and community.",
    apply_url: "https://www.coca-colascholarsfoundation.org/apply/",
    source_url: "https://www.coca-colascholarsfoundation.org/",
    award: award({ amount: 20000, awards_count: 150 }),
    deadline: due(30, { opens_on: isoFromToday(-30) }),
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident", "daca"] },
      { kind: "grade", any_of: ["12"] },
      { kind: "gpa_min", value: 3.0 },
    ],
    other_eligibility: ["Leadership and service in your school or community"],
    requirements: needs({ essays: [{ prompt: "Describe a time you led change in your community.", words: 250 }], transcript: true, interview: true }),
    addedDaysAgo: 3,
  }),
  record({
    id: "elks-mvs",
    name: "Elks Most Valuable Student",
    sponsor: "Elks National Foundation",
    summary: "Scholarships for seniors judged on scholarship, leadership and financial need.",
    apply_url: "https://www.elks.org/scholars/scholarships/mvs.cfm",
    source_url: "https://www.elks.org/scholars/",
    award: award({ kind: "range", min: 4000, max: 50000, renewable: true, years: 4, awards_count: 500 }),
    deadline: due(45),
    basis: ["merit", "need"],
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen"] },
      { kind: "grade", any_of: ["12"] },
    ],
    requirements: needs({
      essays: [
        { prompt: "What is the most important lesson you have learned, and how will it shape your future?", words: 500 },
        { prompt: "Describe your leadership in one activity.", words: 250 },
      ],
      recommendations: 2,
      transcript: true,
      financial_documents: true,
    }),
  }),
  record({
    id: "gates-scholarship",
    name: "The Gates Scholarship",
    sponsor: "Gates Foundation",
    summary:
      "A last-dollar award covering the full cost of attendance for outstanding, high-need seniors.",
    apply_url: "https://www.thegatesscholarship.org/scholarship",
    source_url: "https://www.thegatesscholarship.org/",
    award: award({ kind: "full_ride", renewable: true, years: 4, awards_count: 300 }),
    deadline: due(-16, { opens_on: isoFromToday(-90) }),
    basis: ["need", "merit"],
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident"] },
      { kind: "grade", any_of: ["12"] },
      { kind: "gpa_min", value: 3.3 },
      { kind: "financial_need" },
    ],
    other_eligibility: ["Pell Grant eligible", "Restricted to students from specific backgrounds — see the sponsor's criteria"],
    requirements: needs({ essays: [{ prompt: "Eight short-answer essays on your experiences and goals.", words: 500 }], recommendations: 2, transcript: true, financial_documents: true, interview: true }),
  }),
  record({
    id: "jack-kent-cooke",
    name: "Jack Kent Cooke College Scholarship",
    sponsor: "Jack Kent Cooke Foundation",
    summary: "Up to $55,000 a year for high-achieving seniors with financial need.",
    apply_url: "https://www.jkcf.org/our-scholarships/college-scholarship-program/",
    source_url: "https://www.jkcf.org/",
    award: award({ amount: 55000, renewable: true, years: 4, awards_count: 60 }),
    deadline: due(68, { opens_on: isoFromToday(-14) }),
    basis: ["need", "merit"],
    eligibility: [
      { kind: "grade", any_of: ["12"] },
      { kind: "gpa_min", value: 3.5 },
      { kind: "financial_need" },
    ],
    other_eligibility: ["Family income up to $95,000"],
    requirements: needs({ essays: [{ prompt: "Several short essays about your interests and goals.", words: 400 }], recommendations: 2, transcript: true, financial_documents: true }),
  }),
  record({
    id: "dell-scholars",
    name: "Dell Scholars Program",
    sponsor: "Michael & Susan Dell Foundation",
    summary: "Money plus a laptop, textbook credits and ongoing support for students who've overcome obstacles.",
    apply_url: "https://www.dellscholars.org/scholarship/",
    source_url: "https://www.dellscholars.org/",
    award: award({ amount: 20000, renewable: true, years: 4 }),
    deadline: due(105, { opens_on: isoFromToday(30) }),
    basis: ["need"],
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident"] },
      { kind: "grade", any_of: ["12"] },
      { kind: "gpa_min", value: 2.4 },
      { kind: "financial_need" },
    ],
    other_eligibility: ["In an approved college-readiness program for at least two years", "Pell Grant eligible"],
    requirements: needs({ essays: [{ prompt: "Tell us about the obstacles you've faced.", words: 500 }], transcript: true, financial_documents: true }),
  }),
  record({
    id: "questbridge-match",
    name: "QuestBridge National College Match",
    sponsor: "QuestBridge",
    summary: "Admission and a full four-year scholarship at a partner college for high-achieving, low-income seniors.",
    apply_url: "https://www.questbridge.org/high-school-students/national-college-match",
    source_url: "https://www.questbridge.org/",
    award: award({ kind: "full_ride", renewable: true, years: 4, awards_count: 2000 }),
    deadline: due(-2),
    basis: ["need"],
    eligibility: [
      { kind: "grade", any_of: ["12"] },
      { kind: "financial_need" },
    ],
    other_eligibility: ["Household income generally under $65,000 for a family of four"],
    requirements: needs({ essays: [{ prompt: "Biographical and personal essays.", words: 800 }], recommendations: 2, transcript: true, financial_documents: true }),
  }),
  record({
    id: "burger-king",
    name: "Burger King Scholars",
    sponsor: "Burger King Foundation",
    summary: "Awards for graduating seniors with strong grades, work experience and community service.",
    apply_url: "https://burgerkingfoundation.org/programs/burger-king-scholars",
    source_url: "https://burgerkingfoundation.org/",
    award: award({ kind: "range", min: 1000, max: 60000 }),
    deadline: due(105, { opens_on: isoFromToday(0) }),
    basis: ["merit", "need"],
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident"] },
      { kind: "grade", any_of: ["12"] },
      { kind: "gpa_min", value: 2.5 },
    ],
    requirements: needs({ transcript: true }),
  }),
  record({
    id: "horatio-alger",
    name: "Horatio Alger National Scholarship",
    sponsor: "Horatio Alger Association",
    summary: "For students who have shown integrity and perseverance in overcoming adversity.",
    apply_url: "https://scholars.horatioalger.org/scholarships/",
    source_url: "https://scholars.horatioalger.org/",
    award: award({ amount: 25000, awards_count: 106 }),
    deadline: due(39),
    basis: ["need"],
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen"] },
      { kind: "grade", any_of: ["11", "12"] },
      { kind: "gpa_min", value: 2.0 },
      { kind: "financial_need" },
    ],
    other_eligibility: ["Adjusted gross family income of $65,000 or less"],
    requirements: needs({ essays: [{ prompt: "Describe the adversity you've overcome.", words: 500 }], recommendations: 1, financial_documents: true }),
  }),
  record({
    id: "cal-grant",
    name: "Cal Grant A",
    sponsor: "California Student Aid Commission",
    summary: "State grant that pays tuition at California public universities for eligible residents.",
    apply_url: "https://www.csac.ca.gov/cal-grants",
    source_url: "https://www.csac.ca.gov/",
    award: award({ kind: "full_tuition", renewable: true, years: 4 }),
    deadline: due(150),
    basis: ["need", "merit"],
    eligibility: [
      { kind: "state", any_of: ["CA"] },
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident", "daca"] },
      { kind: "gpa_min", value: 3.0 },
      { kind: "financial_need" },
    ],
    requirements: needs({ financial_documents: true }),
  }),
  record({
    id: "texas-grant",
    name: "TEXAS Grant",
    sponsor: "Texas Higher Education Coordinating Board",
    summary: "Need-based grant for Texas residents attending public colleges in the state.",
    apply_url: "https://www.collegeforalltexans.com/",
    source_url: "https://www.highered.texas.gov/",
    award: award({ amount: 5000, renewable: true, years: 4 }),
    deadline: due(135),
    basis: ["need"],
    eligibility: [
      { kind: "state", any_of: ["TX"] },
      { kind: "financial_need" },
    ],
    requirements: needs({ financial_documents: true }),
  }),
  record({
    id: "regeneron-sts",
    name: "Regeneron Science Talent Search",
    sponsor: "Society for Science",
    summary: "The country's oldest science competition for seniors, judged on an original research project.",
    apply_url: "https://www.societyforscience.org/regeneron-sts/",
    source_url: "https://www.societyforscience.org/",
    award: award({ kind: "range", min: 2000, max: 250000, awards_count: 300 }),
    deadline: due(52),
    fields: ["Biology", "Chemistry", "Computer science", "Engineering", "Mathematics", "Physics"],
    eligibility: [
      { kind: "grade", any_of: ["12"] },
      { kind: "major", any_of: ["Biology", "Chemistry", "Computer science", "Engineering", "Mathematics", "Physics"] },
    ],
    other_eligibility: ["An original research project with a written report"],
    requirements: needs({ essays: [{ prompt: "Research report and several short essays.", words: null }], recommendations: 2, transcript: true }),
  }),
  record({
    id: "davidson-fellows",
    name: "Davidson Fellows",
    sponsor: "Davidson Institute",
    summary: "For students 18 or under who have completed a significant piece of work in STEM, literature or music.",
    apply_url: "https://www.davidsongifted.org/gifted-programs/fellows-scholarship/",
    source_url: "https://www.davidsongifted.org/",
    award: award({ kind: "range", min: 25000, max: 50000, awards_count: 20 }),
    deadline: due(-40),
    fields: ["Science", "Technology", "Engineering", "Mathematics", "Literature", "Music"],
    eligibility: [],
    other_eligibility: ["18 or younger on the deadline", "A completed, significant piece of work"],
    requirements: needs({ essays: [{ prompt: "Three essays and a project description.", words: 1000 }], recommendations: 3 }),
  }),
  record({
    id: "niche-no-essay",
    name: "Niche $25,000 No Essay Scholarship",
    sponsor: "Niche",
    summary: "A monthly drawing. Enter once with a short form; no essay, no GPA requirement.",
    apply_url: "https://www.niche.com/colleges/scholarships/no-essay-scholarship/",
    source_url: "https://www.niche.com/colleges/scholarships/",
    award: award({ amount: 25000, awards_count: 1 }),
    deadline: due(8, { recurs_annually: false }),
    basis: [],
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident"] },
    ],
    requirements: needs(),
    addedDaysAgo: 1,
  }),
  record({
    id: "sallie-mae-bridging",
    name: "Bridging the Dream",
    sponsor: "Sallie Mae Fund",
    summary: "Monthly no-essay drawing for students planning to attend college.",
    apply_url: "https://www.salliemae.com/scholarships/",
    source_url: "https://www.salliemae.com/scholarships/",
    award: award({ amount: 2000 }),
    deadline: ROLLING,
    basis: [],
    eligibility: [],
    requirements: needs(),
  }),
  record({
    id: "first-gen-futures",
    name: "First-Gen Futures Award",
    sponsor: "Bright Path Fund",
    summary: "For students who will be the first in their family to earn a four-year degree.",
    apply_url: "https://example.org/first-gen-futures",
    source_url: "https://example.org/first-gen-futures",
    award: award({ amount: 5000, renewable: true, years: 2, awards_count: 40 }),
    deadline: due(21),
    basis: ["need"],
    eligibility: [
      { kind: "first_gen" },
      { kind: "grade", any_of: ["12"] },
      { kind: "gpa_min", value: 2.8 },
    ],
    requirements: needs({ essays: [{ prompt: "What would being the first to graduate mean to your family?", words: 400 }], recommendations: 1 }),
  }),
  record({
    id: "code-the-future",
    name: "Code the Future Scholarship",
    sponsor: "Open Source Education Alliance",
    summary: "For students planning to study computer science who have built something they're proud of.",
    apply_url: "https://example.org/code-the-future",
    source_url: "https://example.org/code-the-future",
    award: award({ amount: 10000, awards_count: 12 }),
    deadline: due(12),
    fields: ["Computer science", "Software engineering"],
    eligibility: [
      { kind: "major", any_of: ["Computer science", "Software engineering", "Data science"] },
      { kind: "grade", any_of: ["11", "12"] },
    ],
    requirements: needs({ essays: [{ prompt: "Link to and describe a project you built.", words: 300 }] }),
  }),
  record({
    id: "women-in-engineering",
    name: "Women in Engineering Scholarship",
    sponsor: "Engineering Futures Society",
    summary: "Supports women and nonbinary students entering an engineering program.",
    apply_url: "https://example.org/women-in-engineering",
    source_url: "https://example.org/women-in-engineering",
    award: award({ kind: "range", min: 1500, max: 7500, awards_count: 30 }),
    deadline: due(88),
    fields: ["Engineering"],
    eligibility: [
      { kind: "major", any_of: ["Engineering", "Mechanical engineering", "Electrical engineering", "Civil engineering"] },
      { kind: "gpa_min", value: 3.0 },
    ],
    other_eligibility: ["Open to women and nonbinary students"],
    requirements: needs({ essays: [{ prompt: "Why engineering?", words: 500 }], recommendations: 1, transcript: true }),
  }),
  record({
    id: "community-builders",
    name: "Community Builders Award",
    sponsor: "Rotary Foundation (local chapters)",
    summary: "Local awards for students with a record of community service.",
    apply_url: "https://example.org/community-builders",
    source_url: "https://example.org/community-builders",
    award: award({ kind: "varies" }),
    deadline: due(120, { opens_on: isoFromToday(60) }),
    eligibility: [{ kind: "grade", any_of: ["12"] }],
    other_eligibility: ["Live in a participating chapter's area"],
    requirements: needs({ essays: [{ prompt: "Describe your service.", words: 300 }], recommendations: 1 }),
  }),
  record({
    id: "ny-excelsior",
    name: "Excelsior Scholarship",
    sponsor: "New York State HESC",
    summary: "Tuition at SUNY and CUNY colleges for New York residents under an income cap.",
    apply_url: "https://www.hesc.ny.gov/",
    source_url: "https://www.hesc.ny.gov/",
    award: award({ kind: "full_tuition", renewable: true, years: 4 }),
    deadline: due(240),
    basis: ["need"],
    eligibility: [
      { kind: "state", any_of: ["NY"] },
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident"] },
    ],
    other_eligibility: ["Family income of $125,000 or less"],
    requirements: needs({ financial_documents: true }),
    checkedDaysAgo: 220,
  }),
  record({
    id: "arts-merit",
    name: "YoungArts Award",
    sponsor: "National YoungArts Foundation",
    summary: "Recognition and cash awards for artists aged 15–18 across ten disciplines.",
    apply_url: "https://youngarts.org/apply/",
    source_url: "https://youngarts.org/",
    award: award({ kind: "range", min: 250, max: 10000, awards_count: 700 }),
    deadline: due(14),
    fields: ["Visual arts", "Music", "Theater", "Dance", "Writing", "Film"],
    eligibility: [{ kind: "grade", any_of: ["10", "11", "12"] }],
    other_eligibility: ["Aged 15–18 on the deadline"],
    requirements: needs({ essays: [{ prompt: "Portfolio or performance submission with an artist statement.", words: 250 }] }),
  }),
  record({
    id: "hsf",
    name: "HSF Scholar Program",
    sponsor: "Hispanic Scholarship Fund",
    summary: "Merit awards and support services for students of Hispanic heritage.",
    apply_url: "https://www.hsf.net/scholarship",
    source_url: "https://www.hsf.net/",
    award: award({ kind: "range", min: 500, max: 5000, awards_count: 10000 }),
    deadline: due(150, { opens_on: isoFromToday(90) }),
    basis: ["merit", "need"],
    eligibility: [
      { kind: "citizenship", any_of: ["us_citizen", "permanent_resident", "daca"] },
      { kind: "gpa_min", value: 3.0 },
    ],
    other_eligibility: ["Of Hispanic heritage"],
    requirements: needs({ essays: [{ prompt: "Several short essays.", words: 600 }], transcript: true, financial_documents: true }),
  }),
  record({
    id: "future-teachers",
    name: "Future Teachers Fellowship",
    sponsor: "Educators for Tomorrow",
    summary: "For students planning to teach in a public school after graduating.",
    apply_url: "https://example.org/future-teachers",
    source_url: "https://example.org/future-teachers",
    award: award({ amount: 3000, renewable: true, years: 4 }),
    deadline: due(75),
    fields: ["Education"],
    eligibility: [{ kind: "major", any_of: ["Education"] }],
    requirements: needs({ essays: [{ prompt: "Why do you want to teach?", words: 400 }], recommendations: 2 }),
    status: "draft",
  }),
  record({
    id: "rural-scholars",
    name: "Rural Scholars Grant",
    sponsor: "Heartland Community Trust",
    summary: "",
    apply_url: "",
    source_url: "",
    award: award({ amount: 2500 }),
    deadline: due(-5),
    eligibility: [],
    requirements: needs(),
    status: "draft",
    checkedDaysAgo: 300,
  }),
  record({
    id: "old-essay-contest",
    name: "Civic Voices Essay Contest",
    sponsor: "Civic Voices Project",
    summary: "An essay contest on civic participation. The sponsor ended the program.",
    apply_url: "https://example.org/civic-voices",
    source_url: "https://example.org/civic-voices",
    award: award({ amount: 1000 }),
    deadline: due(-200),
    eligibility: [{ kind: "grade", any_of: ["9", "10", "11", "12"] }],
    requirements: needs({ essays: [{ prompt: "What does civic duty mean to you?", words: 800 }] }),
    status: "archived",
  }),
];
