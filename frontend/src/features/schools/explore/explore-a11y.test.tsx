import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import type { Exclusion, ExploreFields, ExploreSchoolCard } from "@/api/schools/explore";
import { classifyFit } from "@/features/schools/explore/classify-fit";
import { defaultFilters } from "@/features/schools/explore/explore-config";
import { ExploreFilterBar } from "@/features/schools/explore/ExploreFilterBar";
import { ExploreFilterPanel } from "@/features/schools/explore/ExploreFilterPanel";
import { ExploreResultsHeader } from "@/features/schools/explore/ExploreResultsHeader";
import { ExploreSearchField } from "@/features/schools/explore/ExploreSearchField";
import type { StudentProfile } from "@/features/schools/explore/explore-types";
import { SchoolResultCard } from "@/features/schools/explore/SchoolResultCard";

/*
 * Honesty/a11y surfaces this unit is directly responsible for (plan §7
 * Phase 2 row): the band caption is a wire string mounted exactly once,
 * every card that shows a band points its own evidence line at that one
 * node, and no exclusion chip ever states an absence as "no {metric}".
 * These earn their place (AGENTS.md: a test has to earn it) because they
 * are the specific clauses the plan calls out as hard gates, not routine
 * render checks.
 */

const BAND_CAPTION_ID = "explore-band-caption";
const BAND_CAPTION_TEXT =
  "This band holds the middle half of the enrolled students who reported a score. " +
  "We don't know how many reported one — treat it as context, not a cutoff.";

const baseFields: ExploreFields = {
  accepts_common_app: null,
  act_composite_avg: null,
  act_composite_p25: null,
  act_composite_p75: null,
  admit_rate: 30,
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
  cost_attendance_in_state: null,
  cost_attendance_out_of_state: null,
  deadline_regular: null,
  entrance_difficulty: null,
  enrolled_total: null,
  faculty_full_time: null,
  faculty_part_time: null,
  faculty_terminal_pct: null,
  gender_model: "coed",
  gpa_avg: null,
  grad_rate_4y: null,
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
  need_met_pct: null,
  offers_early_action: null,
  offers_early_decision: null,
  other_expenses: null,
  region: "New England (CT, ME, MA, NH, RI, VT)",
  religious_affiliation: null,
  retention_pct: null,
  room_and_board: null,
  sat_ebrw_p25: null,
  sat_ebrw_p75: null,
  sat_math_p25: 650,
  sat_math_p75: 740,
  special_programs: null,
  tribal: false,
  tuition_in_state: null,
  tuition_out_of_state: null,
  undergraduate_full_time: null,
  undergraduates: null,
  waitlist_used: null,
  yield_rate: null,
};

function school(overrides: Partial<ExploreFields> = {}): ExploreSchoolCard {
  return {
    city: "Testville",
    fields: { ...baseFields, ...overrides },
    name: "Band University",
    state: "MA",
    unitid: 1,
    website_url: null,
  };
}

const profile: StudentProfile = { act: null, homeState: null, satEbrw: null, satMath: 700 };

describe("Explore band caption -- mounted once, resolvable by every card", () => {
  it("renders the wire caption exactly once, and a card's evidence line resolves aria-describedby to it", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption={BAND_CAPTION_TEXT}
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={100}
          catalogTotal={100}
          exclusions={[]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption
          sort={{ direction: "asc", key: "name" }}
          sortedNullTail={null}
          total={1}
          totalIsCapped={false}
        />
        <SchoolResultCard
          bandCaptionId={BAND_CAPTION_ID}
          href={null}
          onAdd={() => {}}
          profile={profile}
          school={school()}
        />
      </MemoryRouter>,
    );

    // Exactly one node carries the caption text.
    expect(screen.getAllByText(BAND_CAPTION_TEXT)).toHaveLength(1);

    const captionNode = document.getElementById(BAND_CAPTION_ID);
    expect(captionNode).not.toBeNull();
    expect(captionNode).toHaveTextContent(BAND_CAPTION_TEXT);

    // The card's evidence line -- the only element carrying the band text
    // -- resolves its aria-describedby to that exact node.
    const evidenceLine = screen.getByText("SAT Math 650–740").closest("p");
    expect(evidenceLine).toHaveAttribute("aria-describedby", BAND_CAPTION_ID);
    expect(document.getElementById(evidenceLine!.getAttribute("aria-describedby")!)).toBe(
      captionNode,
    );
  });

  it("never renders inside a popover -- the caption node sits in the header's own flow, not a hidden popup", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption={BAND_CAPTION_TEXT}
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={100}
          catalogTotal={100}
          exclusions={[]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption
          sort={{ direction: "asc", key: "name" }}
          sortedNullTail={null}
          total={1}
          totalIsCapped={false}
        />
      </MemoryRouter>,
    );

    // Present on first paint with every popover closed -- no popup markup
    // (Base UI portals popover content to `[data-slot=popover-popup]`) is
    // an ancestor of the caption node.
    const captionNode = document.getElementById(BAND_CAPTION_ID)!;
    expect(captionNode.closest("[data-slot='popover-popup']")).toBeNull();
  });

  it("omits the caption node entirely when nothing on screen shows a band", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption={BAND_CAPTION_TEXT}
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={100}
          catalogTotal={100}
          exclusions={[]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption={false}
          sort={{ direction: "asc", key: "name" }}
          sortedNullTail={null}
          total={1}
          totalIsCapped={false}
        />
      </MemoryRouter>,
    );

    expect(document.getElementById(BAND_CAPTION_ID)).toBeNull();
    expect(screen.queryByText(BAND_CAPTION_TEXT)).not.toBeInTheDocument();
  });
});

describe("Explore results count -- a live region, never colour alone", () => {
  it("exposes the results count as role=status with aria-live", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption=""
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={40}
          catalogTotal={100}
          exclusions={[]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption={false}
          sort={{ direction: "asc", key: "name" }}
          sortedNullTail={null}
          total={40}
          totalIsCapped={false}
        />
      </MemoryRouter>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("40 schools");
  });

  it("renders a capped total as '{N}+ schools', never a false exact count", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption=""
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={3_000}
          catalogTotal={3_500}
          exclusions={[]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption={false}
          sort={{ direction: "asc", key: "name" }}
          sortedNullTail={null}
          total={3_000}
          totalIsCapped
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("3000+ schools");
  });
});

describe("Exclusion chips -- wording chosen by reason, never 'no {metric}'", () => {
  function missing(overrides: Partial<Exclusion> = {}): Exclusion {
    return { count: 12, key: "testPolicy", metric_label: "test policy", reason: "missing", ...overrides };
  }

  it("reads 'not available' for a crawled-fact-fed column (reason: missing)", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption=""
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={100}
          catalogTotal={100}
          exclusions={[missing()]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption={false}
          sort={{ direction: "asc", key: "name" }}
          sortedNullTail={null}
          total={88}
          totalIsCapped={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("12 hidden — test policy not available")).toBeInTheDocument();
    // Built from two pieces rather than one literal: the wording is chosen
    // by `reason`, never "hidden {en dash} no {metric}" (plan §5.3).
    expect(screen.queryByText(new RegExp(`hidden ${"—"} no `))).not.toBeInTheDocument();
  });

  it("reads 'not reported' for a store-we-hold-entirely column (reason: not_reported)", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption=""
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={100}
          catalogTotal={100}
          exclusions={[missing({ key: "gender", metric_label: "gender model", reason: "not_reported" })]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption={false}
          sort={{ direction: "asc", key: "name" }}
          sortedNullTail={null}
          total={88}
          totalIsCapped={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("12 hidden — gender model not reported")).toBeInTheDocument();
    // Built from two pieces rather than one literal: the wording is chosen
    // by `reason`, never "hidden {en dash} no {metric}" (plan §5.3).
    expect(screen.queryByText(new RegExp(`hidden ${"—"} no `))).not.toBeInTheDocument();
  });

  it("renders the null tail as its own chip, with no 'include' affordance", () => {
    render(
      <MemoryRouter>
        <ExploreResultsHeader
          bandCaption=""
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={100}
          catalogTotal={100}
          exclusions={[]}
          factsObservedFrom={null}
          onIncludeMissing={() => {}}
          onProfileChange={() => {}}
          onSortChange={() => {}}
          profile={profile}
          showBandCaption={false}
          sort={{ direction: "asc", key: "admit" }}
          sortedNullTail={{ count: 5, metric_label: "admit rate" }}
          total={88}
          totalIsCapped={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("5 with no admit rate — sorted to the end")).toBeInTheDocument();
    expect(screen.queryByText("include")).not.toBeInTheDocument();
  });
});

describe("classifyFit -- status is never colour alone on the card", () => {
  it("carries the verdict as both a word (badge text) and an accessible sentence naming the evidence", () => {
    const verdict = classifyFit(baseFields.admit_rate);
    render(
      <MemoryRouter>
        <SchoolResultCard bandCaptionId={null} href={null} onAdd={() => {}} profile={profile} school={school()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("group", { name: new RegExp(verdict.reason) })).toBeInTheDocument();
  });
});

describe("Landmarks -- the explore page's own labelled regions/controls", () => {
  it("the search field is a searchbox with an accessible name", () => {
    render(<ExploreSearchField onChange={() => {}} value="" />);
    expect(screen.getByRole("searchbox", { name: "Search schools" })).toBeInTheDocument();
  });

  it("the 'More filters' disclosure button points aria-controls at the panel's real id", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ExploreFilterBar
            activeCount={0}
            controlCounts={{ private: 10, private_for_profit: 2, public: 8 }}
            filters={defaultFilters}
            onChange={() => {}}
            onRangeChange={() => {}}
            onTogglePanel={() => {}}
            panelOpen={false}
            profile={{ act: null, homeState: null, satEbrw: null, satMath: null }}
            regionOptions={[]}
          />
          <ExploreFilterPanel
            activeCount={0}
            campusSettingOptions={[]}
            entranceDifficultyNote={null}
            filters={defaultFilters}
            onChange={() => {}}
            onClearAll={() => {}}
            onOpenChange={() => {}}
            onRangeChange={() => {}}
            open={false}
            religiousAffiliationNote={null}
            religiousAffiliationOptions={[]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const toggle = screen.getByRole("button", { name: /more filters/i });
    const controlsId = toggle.getAttribute("aria-controls");
    expect(controlsId).toBe("explore-filter-panel");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(controlsId!)).not.toBeNull();
  });
});

describe("Focus rings -- the visible-focus token contract, not a pixel", () => {
  it("the search field carries the composer's softer focus-within token", () => {
    const { container } = render(<ExploreSearchField onChange={() => {}} value="" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("focus-within:ring-2");
    expect(wrapper.className).toContain("focus-within:ring-[var(--focus-ring)]/30");
  });

  it("the 'More filters' toggle carries the buttons/chips focus-ring token", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ExploreFilterBar
            activeCount={0}
            controlCounts={{ private: 10, private_for_profit: 2, public: 8 }}
            filters={defaultFilters}
            onChange={() => {}}
            onRangeChange={() => {}}
            onTogglePanel={() => {}}
            panelOpen={false}
            profile={{ act: null, homeState: null, satEbrw: null, satMath: null }}
            regionOptions={[]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const toggle = screen.getByRole("button", { name: /more filters/i });
    expect(toggle.className).toContain("focus-visible:ring-2");
    expect(toggle.className).toContain("focus-visible:ring-[var(--focus-ring)]");
  });
});
