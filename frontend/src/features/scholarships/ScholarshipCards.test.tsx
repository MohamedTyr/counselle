import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { jsonResponse, renderApp } from "@/test/render-app";
import { scholarshipFetch, scholarshipRecord } from "@/test/scholarship-fixtures";
import { ScholarshipCard } from "./ScholarshipCard";
import { awardCadence, deadlineGroup } from "./scholarship-format";

const FIRST = scholarshipRecord({
  name: "Future Leaders Award",
  deadline: { kind: "fixed", date: "2099-03-01", opens_on: null, recurs_annually: true },
});
const SECOND = scholarshipRecord({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Second Chance Award",
});
const listFetch = (saved: readonly string[] = []) =>
  scholarshipFetch(() => jsonResponse({ items: [FIRST, SECOND] }), saved);

afterEach(() => vi.unstubAllGlobals());

it("opens details only on activation and scopes shortcuts to cards", async () => {
  const user = userEvent.setup();
  const { container } = renderApp("/app/scholarships?view=all", { fetchHandler: listFetch() });
  const first = await screen.findByRole("button", {
    name: "Future Leaders Award",
    exact: true,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // Safari pointer activation can leave the button unfocused.
  fireEvent.click(first);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(first).toHaveFocus());
  first.focus();
  await user.keyboard("j");
  const second = container.querySelectorAll("[data-scholarship-open]")[1];
  expect(second).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(second).toHaveFocus());
  const search = screen.getByRole("searchbox", { name: "Search scholarships" });
  await user.click(search);
  await user.type(search, "jks");
  expect(search).toHaveValue("jks");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("saves without opening details and restores focus when an unsaved card disappears", async () => {
  const user = userEvent.setup();
  renderApp("/app/scholarships?view=all", { fetchHandler: listFetch() });
  const save = await screen.findByRole("button", {
    name: "Save Future Leaders Award",
    exact: true,
  });
  await user.click(save);
  await waitFor(() => expect(save).toHaveAttribute("aria-pressed", "true"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: /Saved/ }));
  const savedButton = await screen.findByRole("button", {
    name: "Save Future Leaders Award",
    exact: true,
  });
  await user.click(savedButton);
  await waitFor(() => expect(savedButton).not.toBeInTheDocument());
  await waitFor(() =>
    expect(document.querySelector(".scholarship-results")).toHaveFocus(),
  );
});

it("returns focus to results if a detail action removes the originating saved card", async () => {
  const user = userEvent.setup();
  renderApp("/app/scholarships?view=saved", { fetchHandler: listFetch([FIRST.id]) });
  await user.click(
    await screen.findByRole("button", {
      name: "Future Leaders Award",
      exact: true,
    }),
  );
  const dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Remove from saved" }),
  );
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(document.querySelector(".scholarship-results")).toHaveFocus(),
  );
});

it("reports missing and closed deadlines accurately", () => {
  const scholarship = FIRST;
  expect(deadlineGroup({ ...scholarship.deadline, date: null })).toBe(
    "Deadline unavailable",
  );
  const { rerender } = render(
    <ul>
      <ScholarshipCard
        scholarship={{
          ...scholarship,
          deadline: { ...scholarship.deadline, date: null },
        }}
        isSaved={false}
        onSelect={vi.fn()}
        onToggleSave={vi.fn()}
      />
    </ul>,
  );
  expect(screen.getByText("not available")).toBeInTheDocument();
  expect(screen.queryByText("apply any time")).not.toBeInTheDocument();
  rerender(
    <ul>
      <ScholarshipCard
        scholarship={{
          ...scholarship,
          deadline: { ...scholarship.deadline, date: "2000-01-01" },
        }}
        isSaved={false}
        onSelect={vi.fn()}
        onToggleSave={vi.fn()}
      />
    </ul>,
  );
  expect(screen.getByText("closed this cycle")).toBeInTheDocument();
});

function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

it("does not use the due-soon style for a deadline that has not opened", () => {
  const scholarship = {
    ...FIRST,
    deadline: { kind: "fixed" as const, date: isoInDays(10), opens_on: isoInDays(5), recurs_annually: false },
  };
  render(
    <ul>
      <ScholarshipCard
        scholarship={scholarship}
        isSaved={false}
        onSelect={vi.fn()}
        onToggleSave={vi.fn()}
      />
    </ul>,
  );
  expect(screen.getByText(/^opens /)).not.toHaveClass("scholarship-card-label-soon");
});

it("labels awards only with what is stored", () => {
  const base = { amount: 5000, min: null, max: null, awards_count: null };
  expect(awardCadence({ ...base, kind: "fixed", renewable: true, years: null })).toBe("renewable");
  expect(awardCadence({ ...base, kind: "varies", renewable: false, years: null })).toBe("one-time");
  expect(awardCadence({ ...base, kind: "full_ride", renewable: false, years: null })).toBe("one-time");
  expect(awardCadence({ ...base, kind: "full_ride", renewable: true, years: 4 })).toBe("4 years");
  expect(awardCadence({ ...base, kind: "fixed", renewable: false, years: null })).toBe("one-time");
});

it("has no automated card accessibility violations", async () => {
  const { container } = render(
    <main>
      <h1>Scholarships</h1>
      <h2>Available awards</h2>
      <ul>
        <ScholarshipCard
          scholarship={FIRST}
          isSaved={false}
          onSelect={vi.fn()}
          onToggleSave={vi.fn()}
        />
      </ul>
    </main>,
  );
  expect((await axe(container)).violations).toEqual([]);
});
