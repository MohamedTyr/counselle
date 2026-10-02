import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { SectionShell } from "@/features/schools/facts/profile/SectionShell";
import { SchoolFactsSkeleton } from "@/features/schools/facts/SchoolFactsSkeleton";

/*
 * The facts (About) tab's hard a11y gates: the chapter rail is a named
 * navigation landmark, its rows carry the shared visible-focus token and
 * mark the open chapter with aria-current, and the loading skeleton is
 * aria-busy.
 */

function renderShell() {
  render(
    <SectionShell
      onSelect={() => {}}
      sections={[
        { id: "in", title: "Getting in" },
        { id: "cost", title: "Paying for it" },
      ]}
      selected="in"
    >
      <p>Chapter</p>
    </SectionShell>,
  );
}

describe("Chapter rail", () => {
  test("is a navigation landmark named 'School fact sections'", () => {
    renderShell();
    expect(
      screen.getByRole("navigation", { name: "School fact sections" }),
    ).toBeInTheDocument();
  });

  test("a row carries the shared focus-ring token and the open one is aria-current", () => {
    renderShell();
    const open = screen.getByRole("button", { name: "Getting in" });
    expect(open.className).toContain("focus-visible:ring-2");
    expect(open.className).toContain("focus-visible:ring-[var(--focus-ring)]");
    expect(open).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "Paying for it" }),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("SchoolFactsSkeleton", () => {
  test("marks itself aria-busy while loading", () => {
    const { container } = render(<SchoolFactsSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  });
});
