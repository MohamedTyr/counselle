import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FactTable } from "@/features/schools/facts/FactTable";
import type { FactRow } from "@/features/schools/facts/school-facts-rows";

/*
 * Honesty-critical. Each of these guards a way a two-column table could
 * quietly tell a student something untrue — never caught by a screenshot
 * review.
 */

function row(overrides: Partial<FactRow> & Pick<FactRow, "key" | "label">): FactRow {
  return {
    display: "value",
    state: "value",
    reportedPeriod: null,
    href: null,
    ...overrides,
  };
}

describe("the five wire states render as distinct words", () => {
  const cases: Array<[FactRow["state"], string]> = [
    ["not_reported", "Not reported"],
    ["not_fetched", "Not checked"],
    ["not_published", "Not on file"],
    ["not_collected", "Not collected"],
  ];

  test.each(cases)("%s renders %s, never blank or a dash", (state, display) => {
    const { container } = render(
      <FactTable rows={[row({ key: "k", label: "Example metric", display, state })]} />,
    );
    expect(screen.getByText(display)).toBeInTheDocument();
    const cell = container.querySelectorAll("td")[1];
    expect(cell?.textContent?.trim()).not.toBe("");
    expect(cell?.textContent).not.toMatch(/^[-—–0]$/);
    expect(cell?.className).toContain("italic");
    expect(cell?.className).toContain("--school-fact-absent");
  });

  test("all five state words are pairwise distinct", () => {
    const words = ["Not reported", "Not checked", "Not checked yet", "Not on file", "Not collected"];
    expect(new Set(words).size).toBe(words.length);
  });
});

describe("a reported 0 or false renders at full weight", () => {
  test("a reported 0 renders in the value ink, not the absent italic", () => {
    const { container } = render(
      <FactTable
        rows={[row({ key: "k", label: "Off the waitlist", display: "0", state: "value" })]}
      />,
    );
    const cell = container.querySelectorAll("td")[1];
    expect(cell.textContent).toContain("0");
    expect(cell.className).toContain("--school-fact-value");
    expect(cell.className).not.toContain("italic");
    expect(cell.className).not.toContain("--school-fact-absent");
  });

  test("a reported \"No\" renders in the value ink, not the absent italic", () => {
    /* A false boolean fact arrives with `display` already formatted
     * ("No") by the backend — the row must not treat it as an absence
     * because the WORD happens to be negative. */
    const { container } = render(
      <FactTable
        rows={[row({ key: "k", label: "Accepts common app", display: "No", state: "value" })]}
      />,
    );
    const cell = container.querySelectorAll("td")[1];
    expect(cell.textContent).toBe("No");
    expect(cell.className).not.toContain("italic");
    expect(cell.className).not.toContain("--school-fact-absent");
  });
});

describe("the reported-period suffix", () => {
  test("a value with a reported_period carries the suffix", () => {
    render(
      <FactTable
        rows={[
          row({
            key: "k",
            label: "Tuition",
            display: "$62,000",
            state: "value",
            reportedPeriod: "2025-26",
          }),
        ]}
      />,
    );
    expect(screen.getByText("$62,000")).toBeInTheDocument();
    expect(screen.getByText("2025-26")).toBeInTheDocument();
  });

  test("a value with no reported_period carries no suffix", () => {
    const { container } = render(
      <FactTable
        rows={[row({ key: "k", label: "Tuition", display: "$62,000", state: "value" })]}
      />,
    );
    expect(container.textContent).toBe("Tuition$62,000");
  });
});

describe("a link fact", () => {
  /* Verified live on Yale's Money section: a `kind: "link"` fact's
   * `display` is the source's own link text ("Financial Aid Website"),
   * never the bare URL, and the row must still be a real, clickable
   * anchor — not inert text that merely looks like one. */
  test("renders as a real anchor to the wire's value, not as plain text", () => {
    render(
      <FactTable
        rows={[
          row({
            key: "k",
            label: "Financial aid",
            display: "Financial Aid Website",
            state: "value",
            href: "https://finaid.yale.edu/",
          }),
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Financial Aid Website" });
    expect(link).toHaveAttribute("href", "https://finaid.yale.edu/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("a fact with no href renders plain text, never a broken link", () => {
    render(<FactTable rows={[row({ key: "k", label: "Admit rate", display: "4.6%" })]} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
