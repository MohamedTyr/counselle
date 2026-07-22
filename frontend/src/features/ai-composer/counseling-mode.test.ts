import type { CounselingMode } from "@/api/chat/types";
import type { ChatMessage } from "@/features/ai-chat/model";
import {
  defaultCounselingMode,
  deriveHistoricalModeSkill,
  filterModeSkills,
  findCounselingMode,
  mergeModeAndTaskSkills,
  splitSelectedSkills,
} from "@/features/ai-composer/counseling-mode";

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

function userMessage(
  messageId: string,
  skills: readonly string[],
  synthesized = false,
): ChatMessage {
  return {
    kind: "user",
    messageId,
    conversationId: "session-1",
    parentMessageId: null,
    text: "Question",
    sender: "",
    ts: null,
    isCreatedByUser: true,
    skills: [...skills],
    synthesized,
  };
}

describe("counseling mode helpers", () => {
  it("finds modes by skill name and returns the declared default", () => {
    expect(findCounselingMode(modes, "deep-research")).toBe(modes[1]);
    expect(findCounselingMode(modes, "unknown")).toBeNull();
    expect(defaultCounselingMode(modes)).toBe(modes[0]);
  });

  it("splits one mode from task skills without mutating input", () => {
    const selected = ["school-comparison", "guided-counselor", "school-deep-dive"];

    expect(splitSelectedSkills(selected, modes)).toEqual({
      modeSkill: "guided-counselor",
      taskSkills: ["school-comparison", "school-deep-dive"],
    });
    expect(selected).toEqual([
      "school-comparison",
      "guided-counselor",
      "school-deep-dive",
    ]);
  });

  it("merges mode first and copies task skills", () => {
    const tasks = ["school-comparison"];
    const merged = mergeModeAndTaskSkills("focused-answer", tasks);

    expect(merged).toEqual(["focused-answer", "school-comparison"]);
    expect(merged).not.toBe(tasks);
    expect(mergeModeAndTaskSkills(null, tasks)).toEqual(["school-comparison"]);
  });

  it("derives the newest valid normal user mode with default fallback", () => {
    const messages = [
      userMessage("u1", ["focused-answer"]),
      userMessage("u2", ["guided-counselor"], true),
      userMessage("u3", ["school-comparison"]),
      userMessage("u4", ["deep-research", "school-deep-dive"]),
    ];

    expect(deriveHistoricalModeSkill(messages, modes)).toBe("deep-research");
    expect(deriveHistoricalModeSkill([userMessage("legacy", [])], modes)).toBe(
      "focused-answer",
    );
  });

  it("filters mode skills while preserving ordinary and unknown historical names", () => {
    expect(
      filterModeSkills(
        ["focused-answer", "school-comparison", "retired-skill"],
        modes,
      ),
    ).toEqual(["school-comparison", "retired-skill"]);
  });
});
