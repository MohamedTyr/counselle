import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { exploreFixtures } from "@/features/schools/explore/explore-fixtures";
import type {
  ExploreSchool,
  StudentProfile,
} from "@/features/schools/explore/explore-types";
import { SchoolResultCard } from "@/features/schools/explore/SchoolResultCard";

/*
 * The one render assertion that earns its place: a null metric must render
 * the words "not published". Never 0, never an em dash, never a blank cell
 * — a blank reads as zero, and zero is a lie about a school's aid, cost, or
 * outcomes (AGENTS.md principle 3).
 */

const profile: StudentProfile = { homeState: "MA", satScore: 1480 };

function renderCard(school: ExploreSchool) {
  return render(
    <MemoryRouter>
      <SchoolResultCard
        href={null}
        onAdd={() => {}}
        profile={profile}
        school={school}
      />
    </MemoryRouter>,
  );
}

describe("SchoolResultCard", () => {
  it("names every absent metric rather than leaving a hole", () => {
    renderCard({
      ...exploreFixtures[0],
      admitRate: null,
      cost: null,
      gradFourYear: null,
      meritAid: null,
      needMet: null,
      testBand: null,
    });

    // Cost, the aid slot, and the graduation rate — three absent stats.
    expect(screen.getAllByText("not published")).toHaveLength(3);
    expect(screen.getByText(/admit rate not published/)).toBeInTheDocument();
    expect(screen.getByText(/test range not published/)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("backfills the aid slot instead of leaving a third of the card empty", () => {
    renderCard({ ...exploreFixtures[0], meritAid: 22, needMet: null });

    expect(screen.getByText("got merit aid")).toBeInTheDocument();
    expect(screen.getByText("22%")).toBeInTheDocument();
  });

  /* The caveat is a NUMBER on the card and a SENTENCE only in the accessible
   * name. That split is the point: the card is read twenty-four at a time,
   * so prose on it is read once and skipped twenty-three times, while a
   * screen reader still gets the full explanation of why a band covering
   * 41% of a class is not a band describing that class. */
  it("states a severe test-band caveat as a number, never as prose", () => {
    renderCard({
      ...exploreFixtures[0],
      testBand: { p25: 1480, p75: 1550, submittedPercent: 41 },
    });

    expect(screen.getByText(/41% submitted/)).toBeInTheDocument();
    expect(
      screen.queryByText(/top third of the class/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /Fewer than half this class/ }),
    ).toBeInTheDocument();
  });

  it("keeps a mild caveat inline without escalating it", () => {
    renderCard({
      ...exploreFixtures[0],
      testBand: { p25: 1480, p75: 1550, submittedPercent: 62 },
    });

    expect(screen.getByText(/62% submitted/)).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /Fewer than half/ }),
    ).not.toBeInTheDocument();
  });

  /* The student's own score is a datum on the card, not a computed verdict:
   * classify-fit refuses to move the category on an untrusted band, but the
   * number is still shown next to the range it is being compared against. */
  it("shows the student's score beside the band it is compared to", () => {
    renderCard(exploreFixtures[0]);

    expect(screen.getByText("you 1480")).toBeInTheDocument();
  });

  it("says it is not classified when there is no admit rate to classify on", () => {
    renderCard({ ...exploreFixtures[0], admitRate: null });

    expect(screen.getByText("Not classified")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /not classified/i }),
    ).toBeInTheDocument();
  });
});
