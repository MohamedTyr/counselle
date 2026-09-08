import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import type { ExploreFields, ExploreSchoolCard } from "@/api/schools/explore";
import { SchoolResultCard } from "@/features/schools/explore/SchoolResultCard";
import type { StudentProfile } from "@/features/schools/explore/explore-types";

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

function school(overrides: Partial<ExploreFields> = {}): ExploreSchoolCard {
  return {
    city: "Testville",
    fields: { ...baseFields, ...overrides },
    name: "Test University",
    state: "MA",
    unitid: 1,
    website_url: null,
  };
}

const profile: StudentProfile = { act: null, homeState: "MA", satEbrw: 720, satMath: 740 };

function renderCard(
  card: ExploreSchoolCard,
  overrides: Partial<{ profile: StudentProfile }> = {},
) {
  return render(
    <MemoryRouter>
      <SchoolResultCard
        bandCaptionId={null}
        href={null}
        onAdd={() => {}}
        profile={overrides.profile ?? profile}
        school={card}
      />
    </MemoryRouter>,
  );
}

describe("SchoolResultCard", () => {
  it("names every absent metric rather than leaving a hole", () => {
    renderCard(
      school({
        act_composite_p25: null,
        act_composite_p75: null,
        admit_rate: null,
        cost_attendance_in_state: null,
        cost_attendance_out_of_state: null,
        grad_rate_4y: null,
        need_met_pct: null,
        sat_ebrw_p25: null,
        sat_ebrw_p75: null,
        sat_math_p25: null,
        sat_math_p75: null,
      }),
    );

    // Cost, share of need met, and the graduation rate -- three absent stats.
    expect(screen.getAllByText("not available")).toHaveLength(3);
    expect(screen.getByText(/admit rate not available/)).toBeInTheDocument();
    expect(screen.getByText(/test range not available/)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("picks the in-state cost row when the student's home state matches", () => {
    renderCard(school({ cost_attendance_in_state: 20_000, cost_attendance_out_of_state: 45_000 }));

    expect(screen.getByText("$20,000")).toBeInTheDocument();
    expect(screen.getByText("in-state cost")).toBeInTheDocument();
  });

  it("falls back to the out-of-state row with no home state set", () => {
    renderCard(
      school({ cost_attendance_in_state: 20_000, cost_attendance_out_of_state: 45_000 }),
      { profile: { ...profile, homeState: null } },
    );

    expect(screen.getByText("$45,000")).toBeInTheDocument();
    expect(screen.getByText("out-of-state cost")).toBeInTheDocument();
  });

  it("shows the SAT Math band and the student's own score beside it", () => {
    renderCard(school());

    expect(screen.getByText("SAT Math 700–780")).toBeInTheDocument();
    expect(screen.getByText("you 740")).toBeInTheDocument();
  });

  it("prefers the ACT band for a student who only entered an ACT score", () => {
    renderCard(school({ act_composite_p25: 30, act_composite_p75: 34 }), {
      profile: { act: 32, homeState: "MA", satEbrw: null, satMath: null },
    });

    expect(screen.getByText("ACT 30–34")).toBeInTheDocument();
    expect(screen.getByText("you 32")).toBeInTheDocument();
    expect(screen.queryByText(/^SAT/)).not.toBeInTheDocument();
  });

  it("says it is not classified when there is no admit rate to classify on", () => {
    renderCard(school({ admit_rate: null }));

    expect(screen.getByText("Not classified")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /not classified/i })).toBeInTheDocument();
  });

  it("renders the offered rounds and the regular deadline", () => {
    renderCard(
      school({ deadline_regular: "2027-01-15", offers_early_action: true, offers_early_decision: true }),
    );

    expect(screen.getByText("ED")).toBeInTheDocument();
    expect(screen.getByText("EA")).toBeInTheDocument();
    expect(screen.getByText("Jan 15")).toBeInTheDocument();
  });
});
