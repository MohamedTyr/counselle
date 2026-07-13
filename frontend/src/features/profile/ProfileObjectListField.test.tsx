import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ProfileObjectListField } from "@/features/profile/ProfileObjectListField";
import type { ObjectListFieldConfig } from "@/features/profile/profile-field-types";

const AP_SCORES_CONFIG: ObjectListFieldConfig = {
  addLabel: "Add AP score",
  itemFields: [
    { kind: "text", key: "subject", label: "Subject", required: true },
    {
      kind: "int",
      key: "score",
      label: "Score",
      max: 5,
      min: 1,
      required: true,
    },
  ],
  itemSummary: (item) =>
    typeof item.subject === "string" && item.subject !== ""
      ? item.subject
      : "New entry",
  key: "ap_scores",
  kind: "object-list",
  label: "AP scores",
};

describe("ProfileObjectListField", () => {
  test("keeps incomplete entries local and saves only once required fields are valid", () => {
    const onCommit = vi.fn();
    render(
      <ProfileObjectListField
        config={AP_SCORES_CONFIG}
        onCommit={onCommit}
        value={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add AP score" }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Complete or correct the highlighted fields to save this entry.",
      ),
    ).toBeInTheDocument();

    const subject = screen.getByLabelText("Subject");
    fireEvent.change(subject, { target: { value: "Biology" } });
    fireEvent.blur(subject);

    expect(onCommit).not.toHaveBeenCalled();

    const score = screen.getByLabelText("Score");
    fireEvent.change(score, { target: { value: "4" } });
    fireEvent.blur(score);

    expect(onCommit).toHaveBeenCalledWith([{ score: 4, subject: "Biology" }]);
  });

  test("shows a range error instead of saving an invalid score", () => {
    const onCommit = vi.fn();
    render(
      <ProfileObjectListField
        config={AP_SCORES_CONFIG}
        onCommit={onCommit}
        value={[{ score: 7, subject: "Biology" }]}
      />,
    );

    expect(screen.getByText("Enter 5 or less.")).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
