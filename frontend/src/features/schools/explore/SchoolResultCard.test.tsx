import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const baselineFit: FitEstimate = {
  algorithm_version: "admissions-fit-v1",
  baseline_admit_rate: 45,
  baseline_category: "Target",
  basis: "school_rate",
  category: "Target",
  caveats: [],
  evidence_level: "baseline_only",
  signals: [],
  unavailable: [],
};

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
  overrides: Partial<{
    assumptions: ExploreAssumptions;
    refreshing: boolean;
  }> = {},
) {
  return render(
    <MemoryRouter>
      <SchoolResultCard
        bandCaptionId={null}
        href={null}
        isRefreshingEstimate={overrides.refreshing ?? false}
        onAdd={() => {}}
        assumptions={overrides.assumptions ?? assumptions}
        school={card}
      />
    </MemoryRouter>,
  );
}

describe("SchoolResultCard", () => {
  it("names every absent metric rather than leaving a hole", () => {
    renderCard(
      school(
        {
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
        },
        {
          ...baselineFit,
          baseline_admit_rate: null,
          baseline_category: "Unknown",
          basis: "missing_admit_rate",
          category: "Unknown",
        },
      ),
    );

    // Cost, share of need met, and the graduation rate -- three absent stats.
    expect(screen.getAllByText("not available")).toHaveLength(3);
    expect(screen.getByText(/admit rate not available/i)).toBeInTheDocument();
    expect(screen.getByText(/test range not available/)).toBeInTheDocument();
    expect(screen.getByText("Not classified")).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: /fit: not classified.*admit rate: not available.*admit rate not available/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("picks the in-state cost row when the student's home state matches", () => {
    renderCard(
      school({
        cost_attendance_in_state: 20_000,
        cost_attendance_out_of_state: 45_000,
      }),
    );

    expect(screen.getByText("$20,000")).toBeInTheDocument();
    expect(screen.getByText("in-state cost")).toBeInTheDocument();
  });

  it("falls back to the out-of-state row with no home state set", () => {
    renderCard(
      school({
        cost_attendance_in_state: 20_000,
        cost_attendance_out_of_state: 45_000,
      }),
      { assumptions: { ...assumptions, homeState: null } },
    );

    expect(screen.getByText("$45,000")).toBeInTheDocument();
    expect(screen.getByText("out-of-state cost")).toBeInTheDocument();
  });

  it("labels the institutional score band as an Explore-only preview", () => {
    renderCard(school());

    expect(screen.getByText("SAT Math 700–780")).toBeInTheDocument();
    expect(
      screen.getByText("Explore preview — does not affect estimate"),
    ).toBeInTheDocument();
    expect(screen.queryByText("you 740")).not.toBeInTheDocument();
  });

  it("prefers the ACT band for a student who only entered an ACT score", () => {
    renderCard(school({ act_composite_p25: 30, act_composite_p75: 34 }), {
      assumptions: { act: 32, homeState: "MA", satEbrw: null, satMath: null },
    });

    expect(screen.getByText("ACT 30–34")).toBeInTheDocument();
    expect(
      screen.getByText("Explore preview — does not affect estimate"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^SAT/)).not.toBeInTheDocument();
  });

  it("says it is not classified when there is no admit rate to classify on", () => {
    renderCard(
      school(
        { admit_rate: null },
        {
          ...baselineFit,
          baseline_admit_rate: null,
          baseline_category: "Unknown",
          category: "Unknown",
          basis: "missing_admit_rate",
        },
      ),
    );

    expect(screen.getByText("Not classified")).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /fit: not classified/i }),
    ).toBeInTheDocument();
  });

  it("renders and announces only the canonical fit baseline rate when the card field diverges", () => {
    renderCard(
      school(
        { admit_rate: 8 },
        {
          ...baselineFit,
          baseline_admit_rate: 33.3,
          baseline_category: "Target",
          basis: "personalized",
          category: "Safety",
          evidence_level: "one_comparison",
          signals: [
            {
              assessment: "strong",
              factor: "academic",
              source: "gpa_distribution",
            },
          ],
        },
      ),
    );

    expect(screen.getByText("Safety")).toBeInTheDocument();
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.queryByText("8%")).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: /fit: safety.*admit rate: 33\.3%.*adjusted using your profile.*applied factors: academic.*entering-class benchmarks/i,
      }),
    ).toBeInTheDocument();
  });

  it("keeps deeper baseline factors compact while its basis remains visible", async () => {
    const user = userEvent.setup();
    renderCard(school());

    const disclosure = screen.getByRole("button", {
      name: "How this estimate was made",
    });
    const controls = disclosure.getAttribute("aria-controls");
    const explanation = document.getElementById(controls ?? "");

    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(explanation).toHaveAttribute("hidden");
    expect(screen.getByText("Based on school admit rate")).toBeVisible();
    expect(screen.getAllByText("Based on school admit rate")).toHaveLength(1);
    expect(disclosure).toHaveClass("min-h-6", "min-w-6");
    expect(disclosure).toHaveClass("pointer-coarse:min-h-11");
    expect(disclosure).toHaveClass("focus-visible:ring-2");
    disclosure.focus();
    await user.keyboard("{Enter}");

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(explanation).not.toHaveAttribute("hidden");
    expect(screen.getAllByText("Based on school admit rate")).toHaveLength(1);
    expect(
      screen.queryByText(/chance|probability|index/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the estimate disclosure above the stretched school link", () => {
    render(
      <MemoryRouter>
        <SchoolResultCard
          bandCaptionId={null}
          href="/schools/1"
          onAdd={() => {}}
          assumptions={assumptions}
          school={school()}
        />
      </MemoryRouter>,
    );

    const disclosure = screen.getByRole("button", {
      name: "How this estimate was made",
    });
    const fitRegion = disclosure.closest('[role="group"]');

    expect(screen.getByRole("link", { name: "Test University" })).toHaveClass(
      "after:absolute",
      "after:inset-0",
    );
    expect(fitRegion).toHaveClass("relative", "z-10");
    expect(disclosure).toHaveClass("min-h-6", "min-w-6");
    expect(disclosure).toHaveClass("pointer-coarse:min-h-11");
  });

  it("explains an unchanged personalized estimate and its entering-class caveat after expansion", async () => {
    const user = userEvent.setup();
    renderCard(
      school(
        {},
        {
          ...baselineFit,
          basis: "personalized",
          evidence_level: "two_comparisons",
          signals: [
            {
              assessment: "strong",
              factor: "academic",
              source: "gpa_distribution",
            },
            { assessment: "strong", factor: "testing", source: "sat" },
          ],
        },
      ),
    );

    expect(
      screen.getByRole("group", {
        name: /fit: target.*admit rate: 45%.*checked against your profile.*applied factors: academic, testing.*entering-class benchmarks/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Checked against your profile")).toBeVisible();
    expect(screen.getAllByText("Checked against your profile")).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: "How this estimate was made" }),
    );

    expect(
      screen.getByText("Checked against your profile"),
    ).toBeInTheDocument();
    expect(screen.getByText(/GPA is in the upper part/i)).toBeInTheDocument();
    expect(
      screen.getByText(/SAT scores are in the upper part/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Entering-class benchmarks are context, not admission cutoffs or personal odds/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: /checked against your profile.*entering-class benchmarks.*personal odds/i,
      }),
    ).toBeInTheDocument();
  });

  it("uses adjusted copy when personalization changes the server category", async () => {
    const user = userEvent.setup();
    renderCard(
      school(
        {},
        {
          ...baselineFit,
          baseline_category: "Target",
          basis: "personalized",
          category: "Safety",
          evidence_level: "one_comparison",
          signals: [
            { assessment: "strong", factor: "academic", source: "class_rank" },
          ],
        },
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "How this estimate was made" }),
    );

    expect(screen.getByText("Adjusted using your profile")).toBeInTheDocument();
    expect(
      screen.getByText(/Class rank is in the upper part/i),
    ).toBeInTheDocument();
  });

  it("caps explanations at two factors and preserves the unknown-policy possibility", async () => {
    const user = userEvent.setup();
    renderCard(
      school(
        {},
        {
          ...baselineFit,
          basis: "personalized",
          evidence_level: "two_comparisons",
          signals: [
            { assessment: "weak", factor: "academic", source: "class_rank" },
            { assessment: "strong", factor: "testing", source: "sat_and_act" },
            { assessment: "strong", factor: "testing", source: "act" },
          ],
          unavailable: [
            {
              factor: "testing",
              reason: "test_policy_not_required_or_unknown",
            },
          ],
        },
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "How this estimate was made" }),
    );

    expect(screen.getAllByTestId("fit-applied-factor")).toHaveLength(2);
    expect(
      screen.getByText(
        /testing policy is either not required or not confirmed in our data/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/test_policy_not_required_or_unknown/),
    ).not.toBeInTheDocument();
  });

  it("suppresses a cached estimate until the matching personalized response arrives", () => {
    renderCard(
      school(
        {},
        {
          ...baselineFit,
          basis: "personalized",
          category: "Safety",
          evidence_level: "one_comparison",
          signals: [
            {
              assessment: "strong",
              factor: "academic",
              source: "gpa_distribution",
            },
          ],
        },
      ),
      { refreshing: true },
    );

    expect(screen.getByText("Refreshing estimate…")).toBeInTheDocument();
    expect(screen.queryByText("Safety")).not.toBeInTheDocument();
    expect(screen.queryByText("45%")).not.toBeInTheDocument();
  });

  it("renders the offered rounds and the regular deadline", () => {
    renderCard(
      school({
        deadline_regular: "2027-01-15",
        offers_early_action: true,
        offers_early_decision: true,
      }),
    );

    expect(screen.getByText("ED")).toBeInTheDocument();
    expect(screen.getByText("EA")).toBeInTheDocument();
    expect(screen.getByText("Jan 15")).toBeInTheDocument();
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
