import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function renderComposer(overrides: Partial<Parameters<typeof AiComposer>[0]> = {}) {
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
      screen.getByRole("button", { name: "Counseling mode: Focused Answer" }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", { name: /Guided Counselor/ }),
    );

    expect(onModeChange).toHaveBeenCalledWith(modes[2]);
  });
});
