import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { VizBlock, type VizRenderSpecLike } from "./VizBlock";

function cell(overrides: Partial<VizRenderSpecLike["rows"][number]["cells"][number]> = {}) {
  return {
    v: 1,
    field: "admissions.acceptance_rate",
    label: "Acceptance rate",
    display: "12%",
    available: true,
    citation: { source: "cds", tier: "official", vintage: "CDS 2024" },
    ...overrides,
  };
}

describe("VizBlock", () => {
  test("renders a known stat_block spec with its rows", () => {
    const spec: VizRenderSpecLike = {
      v: 1,
      type: "stat_block",
      title: "North College",
      schools: [{ unitid: 1, name: "North College" }],
      rows: [{ label: "Acceptance rate", cells: [cell()] }],
    };

    render(<VizBlock spec={spec} />);

    expect(screen.getByText("North College")).toBeInTheDocument();
    expect(screen.getByText("Acceptance rate")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("Counselle data")).toBeInTheDocument();
  });

  test("renders a known comparison_table spec across schools", () => {
    const spec: VizRenderSpecLike = {
      v: 1,
      type: "comparison_table",
      title: "Admissions",
      schools: [
        { unitid: 1, name: "North College" },
        { unitid: 2, name: "South College" },
      ],
      rows: [
        {
          label: "Acceptance rate",
          cells: [cell({ display: "12%" }), cell({ display: "34%" })],
        },
      ],
    };

    render(<VizBlock spec={spec} />);

    expect(screen.getByText("North College")).toBeInTheDocument();
    expect(screen.getByText("South College")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("34%")).toBeInTheDocument();
  });

  test("never fabricates an unavailable cell's value", () => {
    const spec: VizRenderSpecLike = {
      v: 1,
      type: "stat_block",
      title: "North College",
      schools: [{ unitid: 1, name: "North College" }],
      rows: [{ label: "Legacy admit rate", cells: [cell({ available: false, display: "" })] }],
    };

    render(<VizBlock spec={spec} />);

    expect(screen.getByText("not available")).toBeInTheDocument();
  });

  test("an unknown spec type degrades to a titled label/value fallback instead of crashing", () => {
    const spec = {
      v: 1,
      type: "future_widget_v9",
      title: "Something new",
      schools: [{ unitid: 1, name: "North College" }],
      rows: [{ label: "Whatever field", cells: [cell({ display: "42" })] }],
    } as VizRenderSpecLike;

    expect(() => render(<VizBlock spec={spec} />)).not.toThrow();
    expect(screen.getByText("Something new")).toBeInTheDocument();
    expect(screen.getByText(/Whatever field:/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  test("a malformed spec missing rows degrades to an empty-but-titled card", () => {
    const spec = {
      v: 1,
      type: "future_widget_v9",
      title: "Malformed",
      schools: [],
      rows: undefined,
    } as unknown as VizRenderSpecLike;

    expect(() => render(<VizBlock spec={spec} />)).not.toThrow();
    expect(screen.getByText("Malformed")).toBeInTheDocument();
  });
});
