import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import { resolveComposerConfig } from "@/api/chat/config";

describe("resolveComposerConfig", () => {
  it("uses server greeting and source defaults on success", () => {
    expect(
      resolveComposerConfig({
        status: "success",
        config: {
          greeting: "Ready to compare schools?",
          season_note: "Hidden on this page",
          conversation_starters: ["Compare Harvard and Yale"],
          default_source_config: {
            web: false,
            edu: true,
            reddit: false,
            reddit_subreddits: ["premed"],
          },
          skills: [
            {
              name: "school-comparison",
              display_name: "School comparison",
              description: "Compare schools side by side.",
            },
          ],
          max_selected_skills: 3,
        },
      }),
    ).toEqual({
      greeting: "Ready to compare schools?",
      sourceConfig: {
        webSearch: false,
        eduSources: true,
        reddit: false,
        selectedSubreddits: ["r/premed"],
      },
      skills: [
        {
          name: "school-comparison",
          displayName: "School comparison",
          description: "Compare schools side by side.",
        },
      ],
      maxSelectedSkills: 3,
    });
  });

  it("uses fallback copy and built-in defaults after config failure", () => {
    expect(resolveComposerConfig({ status: "error" })).toEqual({
      greeting: "Where should we begin?",
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
      skills: [],
      maxSelectedSkills: 0,
    });
  });

  it("uses fallback copy for an empty server greeting", () => {
    expect(
      resolveComposerConfig({
        status: "success",
        config: {
          greeting: "",
          season_note: null,
          conversation_starters: [],
          default_source_config: null,
        },
      }).greeting,
    ).toBe("Where should we begin?");
  });

  it("degrades malformed or missing skill config to a disabled empty picker", () => {
    const config = resolveComposerConfig({
      status: "success",
      config: {
        greeting: "Welcome",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
        skills: [
          {
            name: "school-comparison",
            display_name: "School comparison",
            description: "Compare schools side by side.",
          },
          {
            name: "school-comparison",
            display_name: "Duplicate",
            description: "Should not be shown.",
          },
        ],
        max_selected_skills: 3,
      },
    });

    expect(config.skills).toEqual([]);
    expect(config.maxSelectedSkills).toBe(0);
  });

  it("disables the catalog when its selection limit is missing or invalid", () => {
    const config = resolveComposerConfig({
      status: "success",
      config: {
        greeting: "Welcome",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
        skills: [
          {
            name: "school-comparison",
            display_name: "School comparison",
            description: "Compare schools side by side.",
          },
        ],
        max_selected_skills: Number.NaN,
      },
    });

    expect(config).toMatchObject({ skills: [], maxSelectedSkills: 0 });
  });
});
