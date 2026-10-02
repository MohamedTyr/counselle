import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import type { CounselingMode } from "@/api/chat/types";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import { AiComposer } from "@/features/ai-composer/AiComposer";

const modes: CounselingMode[] = [
  {
    skillName: "focused-answer",
    displayName: "Focused Answer",
    description: "Clear, direct help.",
    order: 10,
    isDefault: true,
  },
  {
    skillName: "deep-research",
    displayName: "Deep Research",
    description: "Investigate carefully.",
    order: 20,
    isDefault: false,
  },
  {
    skillName: "guided-counselor",
    displayName: "Guided Counselor",
    description: "Work through it together.",
    order: 30,
    isDefault: false,
  },
];

function renderComposer(
  overrides: Partial<Parameters<typeof AiComposer>[0]> = {},
) {
  const props = {
    canCancel: false,
    isSubmitting: false,
    onCancel: vi.fn(),
    onSourceConfigChange: vi.fn(),
    onSubmit: vi.fn(),
    onValueChange: vi.fn(),
    sourceConfig: BUILT_IN_SOURCE_CONFIG,
    value: "",
    ...overrides,
  };
  return render(<AiComposer {...props} />);
}

describe("AiComposer", () => {
  test("uses the same counseling mode menu as the chat composer", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    renderComposer({ mode: modes[0], modes, onModeChange });

    await user.click(
      screen.getByRole("button", { name: /^Run settings: Focused Answer/ }),
    );
    await user.click(
      await screen.findByRole("radio", { name: /Guided Counselor/ }),
    );

    expect(onModeChange).toHaveBeenCalledWith(modes[2]);
  });

  test("does not submit Enter while an IME composition is active", () => {
    const onSubmit = vi.fn();
    renderComposer({ onSubmit, value: "相談" });
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  function ControlledComposer(
    props: Omit<
      Partial<Parameters<typeof AiComposer>[0]>,
      "value" | "onValueChange"
    >,
  ) {
    const [value, setValue] = useState("");
    return (
      <AiComposer
        canCancel={false}
        isSubmitting={false}
        onCancel={vi.fn()}
        onSourceConfigChange={vi.fn()}
        onSubmit={vi.fn()}
        sourceConfig={BUILT_IN_SOURCE_CONFIG}
        {...props}
        onValueChange={setValue}
        value={value}
      />
    );
  }

  test("selecting /goal from the menu presses the toggle; sending reports goal_mode true and the toggle clears", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onGoalModeSubmit = vi.fn();
    render(
      <ControlledComposer onGoalModeSubmit={onGoalModeSubmit} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });
    await user.type(textarea, "/goal");
    await screen.findByRole("option", { name: /Goal mode/ });

    await user.keyboard("{Enter}");
    const goalToggle = screen.getByRole("switch", { name: "Goal mode" });
    expect(goalToggle).toHaveAttribute("aria-checked", "true");

    await user.type(textarea, "Help me get into MIT");
    await user.keyboard("{Enter}");

    expect(onGoalModeSubmit).toHaveBeenCalledWith(true);
    expect(onSubmit).toHaveBeenCalled();
    expect(goalToggle).toHaveAttribute("aria-checked", "false");
  });

  test("typing /goal without selecting it submits with goal_mode false", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onGoalModeSubmit = vi.fn();
    render(
      <ControlledComposer onGoalModeSubmit={onGoalModeSubmit} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });
    await user.type(textarea, "/goal");
    await screen.findByRole("option", { name: /Goal mode/ });

    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onGoalModeSubmit).toHaveBeenCalledWith(false);
    expect(onSubmit).toHaveBeenCalled();
  });
});
