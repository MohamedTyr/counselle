import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ReviewMetric } from "@/api/cds-admin/types";

import { MetricEditor } from "./MetricEditor";

/** b88f176: an admin correcting a value off page 8, typing a true excerpt
 * and leaving Page blank, must never silently file page 1 as the source —
 * that's a citation pointing somewhere the value never came from. Save must
 * wait for a real page number on exactly the same terms as the excerpt. */
function metric(overrides: Partial<ReviewMetric> = {}): ReviewMetric {
  return {
    ref: "financial_aid.pct_need_met",
    title: "Percent of need met",
    description: null,
    type: "number",
    unit: "%",
    source_hints: [],
    value: 42,
    raw_value: "42",
    display: "42%",
    availability_status: "reported",
    extraction_status: "verified",
    evidence: null,
    flags: [],
    pending_edit: null,
    ...overrides,
  };
}

describe("MetricEditor — a page number is required alongside the excerpt", () => {
  test("Save stays disabled and shows a hint while the page is blank", () => {
    render(
      <MetricEditor
        metric={metric()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />,
    );

    // No prefill (`evidence: null`), so the page field starts empty.
    fireEvent.change(screen.getByLabelText("Evidence excerpt"), {
      target: { value: "Table 8 shows 42% of need met." },
    });

    expect(screen.getByText("A page number is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("a real page unblocks Save, and the saved payload carries that literal page — never a fallback", () => {
    const onSave = vi.fn();
    render(
      <MetricEditor
        metric={metric()}
        onCancel={vi.fn()}
        onSave={onSave}
        saving={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Evidence page number"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Evidence excerpt"), {
      target: { value: "Table 8 shows 42% of need met." },
    });

    expect(screen.queryByText("A page number is required.")).not.toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ page: 8 }),
      { andNext: false },
    );
  });

  test("pressing Enter with a blank page never submits — the honesty gate isn't just a disabled button", () => {
    const onSave = vi.fn();
    render(
      <MetricEditor
        metric={metric()}
        onCancel={vi.fn()}
        onSave={onSave}
        saving={false}
      />,
    );

    const excerpt = screen.getByLabelText("Evidence excerpt");
    fireEvent.change(excerpt, { target: { value: "Table 8 shows 42%." } });
    fireEvent.keyDown(excerpt, { key: "Enter" });

    expect(onSave).not.toHaveBeenCalled();
  });

  test.each(["0", "-3", "3.7"])(
    "Save stays disabled and shows a hint when the page is %s",
    (badPage) => {
      const onSave = vi.fn();
      render(
        <MetricEditor
          metric={metric()}
          onCancel={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );

      fireEvent.change(screen.getByLabelText("Evidence page number"), {
        target: { value: badPage },
      });
      fireEvent.change(screen.getByLabelText("Evidence excerpt"), {
        target: { value: "Table 8 shows 42% of need met." },
      });

      expect(
        screen.getByText("Page must be a whole number, 1 or greater."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      const excerpt = screen.getByLabelText("Evidence excerpt");
      fireEvent.keyDown(excerpt, { key: "Enter" });
      expect(onSave).not.toHaveBeenCalled();
    },
  );
});
