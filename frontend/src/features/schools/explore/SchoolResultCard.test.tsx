import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import type {
  ExploreFields,
  ExploreSchoolCard,
  FitEstimate,
} from "@/api/schools/explore";
import { SchoolResultCard } from "@/features/schools/explore/SchoolResultCard";
import type { ExploreAssumptions } from "@/features/schools/explore/explore-types";

/*
 * The one render assertion that earns its place: a null metric must render
 * "not available". Never 0, never an em dash, never a blank cell -- a
 * blank reads as zero, and zero is a lie about a school's aid, cost, or
 * outcomes (AGENTS.md principle 3).
 */

const baseFields: ExploreFields = {
  accepts_common_app: null,
  act_composite_avg: null,
  act_composite_p25: null,
  act_composite_p75: null,
  admit_rate: 45,
  admit_rate_men: null,
  admit_rate_women: null,
  admitted_total: null,
  applicants_total: null,
  application_fee: null,
  application_fee_waiver: null,
  avg_indebtedness: null,
  books_and_supplies: null,
  calendar: null,
  control: "private",
  cost_attendance_in_state: 62_000,
  cost_attendance_out_of_state: 62_000,
  deadline_regular: "2027-01-01",
  entrance_difficulty: null,
  enrolled_total: null,
  faculty_full_time: null,
  faculty_part_time: null,
  faculty_terminal_pct: null,
  gender_model: "coed",
  gpa_avg: null,
  grad_rate_4y: 88,
  grad_rate_5y: null,
  grad_rate_6y: null,
  graduate_students: null,
  graduates_with_loans_pct: null,
  greek_pct_men: null,
  greek_pct_women: null,
  hbcu: false,
  housing_pct: null,
  hsi: null,
  institution_level: null,
  international_pct: null,
  is_rolling: null,
  land_grant: false,
  locale: null,
  majors: null,
  majors_count: null,
  need_met_pct: 72,
  offers_early_action: null,
  offers_early_decision: null,
  other_expenses: null,
  region: "New England (CT, ME, MA, NH, RI, VT)",
  religious_affiliation: null,
  retention_pct: null,
  room_and_board: null,
  sat_ebrw_p25: 700,
  sat_ebrw_p75: 760,
  sat_math_p25: 700,
  sat_math_p75: 780,
  special_programs: null,
  tribal: false,
  tuition_in_state: null,
  tuition_out_of_state: null,
  undergraduate_full_time: null,
  undergraduates: 6_500,
  waitlist_used: null,
  yield_rate: null,
};

const baselineFit: FitEstimate = { admit_rate: 45, category: "Target" };

function school(
  overrides: Partial<ExploreFields> = {},
  fit: FitEstimate = baselineFit,
): ExploreSchoolCard {
  return {
    city: "Testville",
    fields: { ...baseFields, ...overrides },
    fit,
    name: "Test University",
    state: "MA",
    unitid: 1,
    website_url: null,
  };
}

const assumptions: ExploreAssumptions = {
  act: null,
  homeState: "MA",
  satEbrw: 720,
  satMath: 740,
};

function renderCard(
  card: ExploreSchoolCard,
  overrides: Partial<{ assumptions: ExploreAssumptions }> = {},
) {
  return render(
    <MemoryRouter>
      <SchoolResultCard
        href={null}
        onAdd={() => {}}
        assumptions={overrides.assumptions ?? assumptions}
        school={card}
      />
    </MemoryRouter>,
  );
}

describe("SchoolResultCard", () => {
  it("names every absent figure rather than leaving a hole", () => {
    renderCard(
      school(
        {
          admit_rate: null,
          cost_attendance_in_state: null,
          cost_attendance_out_of_state: null,
        },
        { admit_rate: null, category: "Unknown" },
      ),
    );

    // The admit rate and the cost -- both figures the card carries.
    expect(screen.getAllByText("not available")).toHaveLength(2);
    expect(
      screen.getByRole("group", { name: /admit rate: not available/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("picks the in-state cost when the student's home state matches", () => {
    renderCard(
      school({
        cost_attendance_in_state: 20_000,
        cost_attendance_out_of_state: 45_000,
      }),
    );

    expect(screen.getByText("$20,000")).toBeInTheDocument();
    expect(screen.getByText("per year, in state")).toBeInTheDocument();
  });

  it("falls back to the out-of-state cost with no home state set", () => {
    renderCard(
      school({
        cost_attendance_in_state: 20_000,
        cost_attendance_out_of_state: 45_000,
      }),
      { assumptions: { ...assumptions, homeState: null } },
    );

    expect(screen.getByText("$45,000")).toBeInTheDocument();
    expect(screen.getByText("per year, out of state")).toBeInTheDocument();
  });

  it("shows the category the admit rate beside it implies, and nothing arguing for it", () => {
    renderCard(school({ admit_rate: 45 }));

    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    // There is no reasoning to disclose: the rate is the whole argument.
    expect(screen.queryByRole("button", { name: /target/i })).toBeNull();
    expect(
      screen.getByRole("group", { name: /admit rate: 45%\. Target\./i }),
    ).toBeInTheDocument();
  });

  it("claims no band at all when there is no admit rate to classify on", () => {
    renderCard(
      school({ admit_rate: null }, { admit_rate: null, category: "Unknown" }),
    );

    for (const label of [
      "Unknown",
      "Not classified",
      "Reach",
      "Target",
      "Safety",
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("does not clamp a legitimate long school name and keeps its Add action", () => {
    const longName =
      "University of the Commonwealth and International Studies at North River";
    renderCard({ ...school(), name: longName });

    const heading = screen.getByRole("heading", { name: longName });
    expect(heading).not.toHaveClass("line-clamp-2");
    expect(heading).not.toHaveClass("truncate");
    expect(
      screen.getByRole("button", { name: `Add ${longName} to your list` }),
    ).toBeInTheDocument();
  });
});
