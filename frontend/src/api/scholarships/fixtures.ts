import type {
  Award,
  Deadline,
  Requirements,
  Scholarship,
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
    awardsCount: null,
    ...partial,
  };
}

function due(days: number, partial: Partial<Deadline> = {}): Deadline {
  return {
    kind: "fixed",
    date: isoFromToday(days),
    opensOn: null,
    recursAnnually: true,
    ...partial,
  };
}

const ROLLING: Deadline = {
  kind: "rolling",
  date: null,
  opensOn: null,
  recursAnnually: false,
};

function needs(partial: Partial<Requirements> = {}): Requirements {
  return {
    essays: [],
    recommendations: 0,
    transcript: false,
    financialDocuments: false,
    interview: false,
    ...partial,
  };
}

type Seed = Omit<
  Scholarship,
  "createdAt" | "updatedAt" | "updatedBy" | "lastCheckedOn" | "status" | "otherEligibility" | "fields" | "basis" | "logoUrl"
> &
  Partial<Pick<Scholarship, "status" | "otherEligibility" | "fields" | "basis" | "logoUrl">> & {
    checkedDaysAgo?: number;
    addedDaysAgo?: number;
  };

/** A stable spread of ages so the admin list doesn't show one date everywhere. */
function spread(id: string, min: number, max: number): number {
  const hash = [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7);
  return min + (hash % (max - min + 1));
}

function record(seed: Seed): Scholarship {
  const { checkedDaysAgo = spread(seed.id, 2, 120), addedDaysAgo = spread(seed.id + "+", 10, 200), ...rest } = seed;
  return {
    status: "published",
    otherEligibility: [],
    fields: [],
    basis: ["merit"],
    logoUrl: "",
    ...rest,
    lastCheckedOn: isoFromToday(-checkedDaysAgo),
    createdAt: `${isoFromToday(-addedDaysAgo)}T15:00:00Z`,
    updatedAt: `${isoFromToday(-Math.min(addedDaysAgo, checkedDaysAgo))}T15:00:00Z`,
    updatedBy: "Mohamed A.",
  };
}

export const SCHOLARSHIP_FIXTURES: Scholarship[] = [
  record({
    id: "coca-cola-scholars",
    name: "Coca-Cola Scholars",
    sponsor: "Coca-Cola Scholars Foundation",
    summary:
      "A leadership award for seniors who have made a measurable difference in their school and community.",
    applyUrl: "https://www.coca-colascholarsfoundation.org/apply/",
    sourceUrl: "https://www.coca-colascholarsfoundation.org/",
    award: award({ amount: 20000, awardsCount: 150 }),
    deadline: due(30, { opensOn: isoFromToday(-30) }),
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident", "daca"] },
      { kind: "grade", anyOf: ["12"] },
      { kind: "gpa_min", value: 3.0 },
    ],
    otherEligibility: ["Leadership and service in your school or community"],
    requirements: needs({ essays: [{ prompt: "Describe a time you led change in your community.", words: 250 }], transcript: true, interview: true }),
    addedDaysAgo: 3,
  }),
  record({
    id: "elks-mvs",
    name: "Elks Most Valuable Student",
    sponsor: "Elks National Foundation",
    summary: "Scholarships for seniors judged on scholarship, leadership and financial need.",
    applyUrl: "https://www.elks.org/scholars/scholarships/mvs.cfm",
    sourceUrl: "https://www.elks.org/scholars/",
    award: award({ kind: "range", min: 4000, max: 50000, renewable: true, years: 4, awardsCount: 500 }),
    deadline: due(45),
    basis: ["merit", "need"],
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen"] },
      { kind: "grade", anyOf: ["12"] },
    ],
    requirements: needs({
      essays: [
        { prompt: "What is the most important lesson you have learned, and how will it shape your future?", words: 500 },
        { prompt: "Describe your leadership in one activity.", words: 250 },
      ],
      recommendations: 2,
      transcript: true,
      financialDocuments: true,
    }),
  }),
  record({
    id: "gates-scholarship",
    name: "The Gates Scholarship",
    sponsor: "Gates Foundation",
    summary:
      "A last-dollar award covering the full cost of attendance for outstanding, high-need seniors.",
    applyUrl: "https://www.thegatesscholarship.org/scholarship",
    sourceUrl: "https://www.thegatesscholarship.org/",
    award: award({ kind: "full_ride", renewable: true, years: 4, awardsCount: 300 }),
    deadline: due(-16, { opensOn: isoFromToday(-90) }),
    basis: ["need", "merit"],
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident"] },
      { kind: "grade", anyOf: ["12"] },
      { kind: "gpa_min", value: 3.3 },
      { kind: "financial_need" },
    ],
    otherEligibility: ["Pell Grant eligible", "Restricted to students from specific backgrounds — see the sponsor's criteria"],
    requirements: needs({ essays: [{ prompt: "Eight short-answer essays on your experiences and goals.", words: 500 }], recommendations: 2, transcript: true, financialDocuments: true, interview: true }),
  }),
  record({
    id: "jack-kent-cooke",
    name: "Jack Kent Cooke College Scholarship",
    sponsor: "Jack Kent Cooke Foundation",
    summary: "Up to $55,000 a year for high-achieving seniors with financial need.",
    applyUrl: "https://www.jkcf.org/our-scholarships/college-scholarship-program/",
    sourceUrl: "https://www.jkcf.org/",
    award: award({ amount: 55000, renewable: true, years: 4, awardsCount: 60 }),
    deadline: due(68, { opensOn: isoFromToday(-14) }),
    basis: ["need", "merit"],
    eligibility: [
      { kind: "grade", anyOf: ["12"] },
      { kind: "gpa_min", value: 3.5 },
      { kind: "financial_need" },
    ],
    otherEligibility: ["Family income up to $95,000"],
    requirements: needs({ essays: [{ prompt: "Several short essays about your interests and goals.", words: 400 }], recommendations: 2, transcript: true, financialDocuments: true }),
  }),
  record({
    id: "dell-scholars",
    name: "Dell Scholars Program",
    sponsor: "Michael & Susan Dell Foundation",
    summary: "Money plus a laptop, textbook credits and ongoing support for students who've overcome obstacles.",
    applyUrl: "https://www.dellscholars.org/scholarship/",
    sourceUrl: "https://www.dellscholars.org/",
    award: award({ amount: 20000, renewable: true, years: 4 }),
    deadline: due(105, { opensOn: isoFromToday(30) }),
    basis: ["need"],
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident"] },
      { kind: "grade", anyOf: ["12"] },
      { kind: "gpa_min", value: 2.4 },
      { kind: "financial_need" },
    ],
    otherEligibility: ["In an approved college-readiness program for at least two years", "Pell Grant eligible"],
    requirements: needs({ essays: [{ prompt: "Tell us about the obstacles you've faced.", words: 500 }], transcript: true, financialDocuments: true }),
  }),
  record({
    id: "questbridge-match",
    name: "QuestBridge National College Match",
    sponsor: "QuestBridge",
    summary: "Admission and a full four-year scholarship at a partner college for high-achieving, low-income seniors.",
    applyUrl: "https://www.questbridge.org/high-school-students/national-college-match",
    sourceUrl: "https://www.questbridge.org/",
    award: award({ kind: "full_ride", renewable: true, years: 4, awardsCount: 2000 }),
    deadline: due(-2),
    basis: ["need"],
    eligibility: [
      { kind: "grade", anyOf: ["12"] },
      { kind: "financial_need" },
    ],
    otherEligibility: ["Household income generally under $65,000 for a family of four"],
    requirements: needs({ essays: [{ prompt: "Biographical and personal essays.", words: 800 }], recommendations: 2, transcript: true, financialDocuments: true }),
  }),
  record({
    id: "burger-king",
    name: "Burger King Scholars",
    sponsor: "Burger King Foundation",
    summary: "Awards for graduating seniors with strong grades, work experience and community service.",
    applyUrl: "https://burgerkingfoundation.org/programs/burger-king-scholars",
    sourceUrl: "https://burgerkingfoundation.org/",
    award: award({ kind: "range", min: 1000, max: 60000 }),
    deadline: due(105, { opensOn: isoFromToday(0) }),
    basis: ["merit", "need"],
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident"] },
      { kind: "grade", anyOf: ["12"] },
      { kind: "gpa_min", value: 2.5 },
    ],
    requirements: needs({ transcript: true }),
  }),
  record({
    id: "horatio-alger",
    name: "Horatio Alger National Scholarship",
    sponsor: "Horatio Alger Association",
    summary: "For students who have shown integrity and perseverance in overcoming adversity.",
    applyUrl: "https://scholars.horatioalger.org/scholarships/",
    sourceUrl: "https://scholars.horatioalger.org/",
    award: award({ amount: 25000, awardsCount: 106 }),
    deadline: due(39),
    basis: ["need"],
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen"] },
      { kind: "grade", anyOf: ["11", "12"] },
      { kind: "gpa_min", value: 2.0 },
      { kind: "financial_need" },
    ],
    otherEligibility: ["Adjusted gross family income of $65,000 or less"],
    requirements: needs({ essays: [{ prompt: "Describe the adversity you've overcome.", words: 500 }], recommendations: 1, financialDocuments: true }),
  }),
  record({
    id: "cal-grant",
    name: "Cal Grant A",
    sponsor: "California Student Aid Commission",
    summary: "State grant that pays tuition at California public universities for eligible residents.",
    applyUrl: "https://www.csac.ca.gov/cal-grants",
    sourceUrl: "https://www.csac.ca.gov/",
    award: award({ kind: "full_tuition", renewable: true, years: 4 }),
    deadline: due(150),
    basis: ["need", "merit"],
    eligibility: [
      { kind: "state", anyOf: ["CA"] },
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident", "daca"] },
      { kind: "gpa_min", value: 3.0 },
      { kind: "financial_need" },
    ],
    requirements: needs({ financialDocuments: true }),
  }),
  record({
    id: "texas-grant",
    name: "TEXAS Grant",
    sponsor: "Texas Higher Education Coordinating Board",
    summary: "Need-based grant for Texas residents attending public colleges in the state.",
    applyUrl: "https://www.collegeforalltexans.com/",
    sourceUrl: "https://www.highered.texas.gov/",
    award: award({ amount: 5000, renewable: true, years: 4 }),
    deadline: due(135),
    basis: ["need"],
    eligibility: [
      { kind: "state", anyOf: ["TX"] },
      { kind: "financial_need" },
    ],
    requirements: needs({ financialDocuments: true }),
  }),
  record({
    id: "regeneron-sts",
    name: "Regeneron Science Talent Search",
    sponsor: "Society for Science",
    summary: "The country's oldest science competition for seniors, judged on an original research project.",
    applyUrl: "https://www.societyforscience.org/regeneron-sts/",
    sourceUrl: "https://www.societyforscience.org/",
    award: award({ kind: "range", min: 2000, max: 250000, awardsCount: 300 }),
    deadline: due(52),
    fields: ["Biology", "Chemistry", "Computer science", "Engineering", "Mathematics", "Physics"],
    eligibility: [
      { kind: "grade", anyOf: ["12"] },
      { kind: "major", anyOf: ["Biology", "Chemistry", "Computer science", "Engineering", "Mathematics", "Physics"] },
    ],
    otherEligibility: ["An original research project with a written report"],
    requirements: needs({ essays: [{ prompt: "Research report and several short essays.", words: null }], recommendations: 2, transcript: true }),
  }),
  record({
    id: "davidson-fellows",
    name: "Davidson Fellows",
    sponsor: "Davidson Institute",
    summary: "For students 18 or under who have completed a significant piece of work in STEM, literature or music.",
    applyUrl: "https://www.davidsongifted.org/gifted-programs/fellows-scholarship/",
    sourceUrl: "https://www.davidsongifted.org/",
    award: award({ kind: "range", min: 25000, max: 50000, awardsCount: 20 }),
    deadline: due(-40),
    fields: ["Science", "Technology", "Engineering", "Mathematics", "Literature", "Music"],
    eligibility: [],
    otherEligibility: ["18 or younger on the deadline", "A completed, significant piece of work"],
    requirements: needs({ essays: [{ prompt: "Three essays and a project description.", words: 1000 }], recommendations: 3 }),
  }),
  record({
    id: "niche-no-essay",
    name: "Niche $25,000 No Essay Scholarship",
    sponsor: "Niche",
    summary: "A monthly drawing. Enter once with a short form; no essay, no GPA requirement.",
    applyUrl: "https://www.niche.com/colleges/scholarships/no-essay-scholarship/",
    sourceUrl: "https://www.niche.com/colleges/scholarships/",
    award: award({ amount: 25000, awardsCount: 1 }),
    deadline: due(8, { recursAnnually: false }),
    basis: [],
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident"] },
    ],
    requirements: needs(),
    addedDaysAgo: 1,
  }),
  record({
    id: "sallie-mae-bridging",
    name: "Bridging the Dream",
    sponsor: "Sallie Mae Fund",
    summary: "Monthly no-essay drawing for students planning to attend college.",
    applyUrl: "https://www.salliemae.com/scholarships/",
    sourceUrl: "https://www.salliemae.com/scholarships/",
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
    applyUrl: "https://example.org/first-gen-futures",
    sourceUrl: "https://example.org/first-gen-futures",
    award: award({ amount: 5000, renewable: true, years: 2, awardsCount: 40 }),
    deadline: due(21),
    basis: ["need"],
    eligibility: [
      { kind: "first_gen" },
      { kind: "grade", anyOf: ["12"] },
      { kind: "gpa_min", value: 2.8 },
    ],
    requirements: needs({ essays: [{ prompt: "What would being the first to graduate mean to your family?", words: 400 }], recommendations: 1 }),
  }),
  record({
    id: "code-the-future",
    name: "Code the Future Scholarship",
    sponsor: "Open Source Education Alliance",
    summary: "For students planning to study computer science who have built something they're proud of.",
    applyUrl: "https://example.org/code-the-future",
    sourceUrl: "https://example.org/code-the-future",
    award: award({ amount: 10000, awardsCount: 12 }),
    deadline: due(12),
    fields: ["Computer science", "Software engineering"],
    eligibility: [
      { kind: "major", anyOf: ["Computer science", "Software engineering", "Data science"] },
      { kind: "grade", anyOf: ["11", "12"] },
    ],
    requirements: needs({ essays: [{ prompt: "Link to and describe a project you built.", words: 300 }] }),
  }),
  record({
    id: "women-in-engineering",
    name: "Women in Engineering Scholarship",
    sponsor: "Engineering Futures Society",
    summary: "Supports women and nonbinary students entering an engineering program.",
    applyUrl: "https://example.org/women-in-engineering",
    sourceUrl: "https://example.org/women-in-engineering",
    award: award({ kind: "range", min: 1500, max: 7500, awardsCount: 30 }),
    deadline: due(88),
    fields: ["Engineering"],
    eligibility: [
      { kind: "major", anyOf: ["Engineering", "Mechanical engineering", "Electrical engineering", "Civil engineering"] },
      { kind: "gpa_min", value: 3.0 },
    ],
    otherEligibility: ["Open to women and nonbinary students"],
    requirements: needs({ essays: [{ prompt: "Why engineering?", words: 500 }], recommendations: 1, transcript: true }),
  }),
  record({
    id: "community-builders",
    name: "Community Builders Award",
    sponsor: "Rotary Foundation (local chapters)",
    summary: "Local awards for students with a record of community service.",
    applyUrl: "https://example.org/community-builders",
    sourceUrl: "https://example.org/community-builders",
    award: award({ kind: "varies" }),
    deadline: due(120, { opensOn: isoFromToday(60) }),
    eligibility: [{ kind: "grade", anyOf: ["12"] }],
    otherEligibility: ["Live in a participating chapter's area"],
    requirements: needs({ essays: [{ prompt: "Describe your service.", words: 300 }], recommendations: 1 }),
  }),
  record({
    id: "ny-excelsior",
    name: "Excelsior Scholarship",
    sponsor: "New York State HESC",
    summary: "Tuition at SUNY and CUNY colleges for New York residents under an income cap.",
    applyUrl: "https://www.hesc.ny.gov/",
    sourceUrl: "https://www.hesc.ny.gov/",
    award: award({ kind: "full_tuition", renewable: true, years: 4 }),
    deadline: due(240),
    basis: ["need"],
    eligibility: [
      { kind: "state", anyOf: ["NY"] },
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident"] },
    ],
    otherEligibility: ["Family income of $125,000 or less"],
    requirements: needs({ financialDocuments: true }),
    checkedDaysAgo: 220,
  }),
  record({
    id: "arts-merit",
    name: "YoungArts Award",
    sponsor: "National YoungArts Foundation",
    summary: "Recognition and cash awards for artists aged 15–18 across ten disciplines.",
    applyUrl: "https://youngarts.org/apply/",
    sourceUrl: "https://youngarts.org/",
    award: award({ kind: "range", min: 250, max: 10000, awardsCount: 700 }),
    deadline: due(14),
    fields: ["Visual arts", "Music", "Theater", "Dance", "Writing", "Film"],
    eligibility: [{ kind: "grade", anyOf: ["10", "11", "12"] }],
    otherEligibility: ["Aged 15–18 on the deadline"],
    requirements: needs({ essays: [{ prompt: "Portfolio or performance submission with an artist statement.", words: 250 }] }),
  }),
  record({
    id: "hsf",
    name: "HSF Scholar Program",
    sponsor: "Hispanic Scholarship Fund",
    summary: "Merit awards and support services for students of Hispanic heritage.",
    applyUrl: "https://www.hsf.net/scholarship",
    sourceUrl: "https://www.hsf.net/",
    award: award({ kind: "range", min: 500, max: 5000, awardsCount: 10000 }),
    deadline: due(150, { opensOn: isoFromToday(90) }),
    basis: ["merit", "need"],
    eligibility: [
      { kind: "citizenship", anyOf: ["us_citizen", "permanent_resident", "daca"] },
      { kind: "gpa_min", value: 3.0 },
    ],
    otherEligibility: ["Of Hispanic heritage"],
    requirements: needs({ essays: [{ prompt: "Several short essays.", words: 600 }], transcript: true, financialDocuments: true }),
  }),
  record({
    id: "future-teachers",
    name: "Future Teachers Fellowship",
    sponsor: "Educators for Tomorrow",
    summary: "For students planning to teach in a public school after graduating.",
    applyUrl: "https://example.org/future-teachers",
    sourceUrl: "https://example.org/future-teachers",
    award: award({ amount: 3000, renewable: true, years: 4 }),
    deadline: due(75),
    fields: ["Education"],
    eligibility: [{ kind: "major", anyOf: ["Education"] }],
    requirements: needs({ essays: [{ prompt: "Why do you want to teach?", words: 400 }], recommendations: 2 }),
    status: "draft",
  }),
  record({
    id: "rural-scholars",
    name: "Rural Scholars Grant",
    sponsor: "Heartland Community Trust",
    summary: "",
    applyUrl: "",
    sourceUrl: "",
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
    applyUrl: "https://example.org/civic-voices",
    sourceUrl: "https://example.org/civic-voices",
    award: award({ amount: 1000 }),
    deadline: due(-200),
    eligibility: [{ kind: "grade", anyOf: ["9", "10", "11", "12"] }],
    requirements: needs({ essays: [{ prompt: "What does civic duty mean to you?", words: 800 }] }),
    status: "archived",
  }),
];
