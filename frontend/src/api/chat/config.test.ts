import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import { resolveComposerConfig } from "@/api/chat/config";

const publicSkillWires = [
  {
    name: "application-rounds",
    display_name: "Application rounds",
    description: "Choose ED/EA/REA/RD timing and deadline strategy.",
  },
  {
    name: "chancing",
    display_name: "Chancing",
    description: "Classify reach, target, and likely odds without fake predictions.",
  },
  {
    name: "costs-and-aid",
    display_name: "Costs and aid",
    description: "Plan affordability, financial aid, FAFSA/CSS, and scholarships.",
  },
  {
    name: "essay-fit",
    display_name: "Essay fit",
    description: "Find real school-specific details for essays and fit.",
  },
  {
    name: "major-and-fit",
    display_name: "Major and fit",
    description: "Decide major strategy, program fit, and major-specific constraints.",
  },
  {
    name: "school-comparison",
    display_name: "School comparison",
    description: "Compare schools across cost, admissions, outcomes, and fit.",
  },
  {
    name: "school-deep-dive",
    display_name: "School deep dive",
    description: "Build a cited, in-depth look at one school.",
  },
  {
    name: "school-list",
    display_name: "School list",
    description: "Build, trim, or audit a balanced college list.",
  },
  {
    name: "testing-strategy",
    display_name: "Testing strategy",
    description: "Decide SAT/ACT retakes, policies, and submit-or-withhold moves.",
  },
];

const publicSkills = publicSkillWires.map((skill) => ({
  name: skill.name,
  displayName: skill.display_name,
  description: skill.description,
}));

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
          skills: publicSkillWires,
          skill_modes: [
            {
              name: "guided-counselor",
              display_name: "Guided Counselor",
              description: "Work through it together.",
              order: 30,
              default: false,
            },
            {
              name: "focused-answer",
              display_name: "Focused Answer",
              description: "Clear, direct help.",
              order: 10,
              default: true,
            },
            {
              name: "deep-research",
              display_name: "Deep Research",
              description: "Investigate carefully.",
              order: 20,
              default: false,
            },
          ],
          max_selected_skills: 3,
        },
      }),
    ).toEqual({
      greeting: "Ready to compare schools?",
      defaultResponseMode: "quick",
      responseModes: [
        {
          id: "quick",
          model: "",
          modelDisplayName: "Quick",
          preview: false,
        },
      ],
      sourceConfig: {
        webSearch: false,
        eduSources: true,
        reddit: false,
        selectedSubreddits: ["r/premed"],
      },
      skills: publicSkills,
      skillModes: [
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
      ],
      defaultSkillMode: {
        skillName: "focused-answer",
        displayName: "Focused Answer",
        description: "Clear, direct help.",
        order: 10,
        isDefault: true,
      },
      maxSelectedSkills: 3,
    });
  });

  it("uses fallback copy and built-in defaults after config failure", () => {
    expect(resolveComposerConfig({ status: "error" })).toEqual({
      greeting: "Where should we begin?",
      defaultResponseMode: "quick",
      responseModes: [
        {
          id: "quick",
          model: "",
          modelDisplayName: "Quick",
          preview: false,
        },
      ],
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
      skills: [],
      skillModes: [],
      defaultSkillMode: null,
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
        skill_modes: [
          {
            name: "focused-answer",
            display_name: "Focused Answer",
            description: "Clear, direct help.",
            order: 10,
            default: true,
          },
          {
            name: "deep-research",
            display_name: "Deep Research",
            description: "Investigate carefully.",
            order: 20,
            default: false,
          },
          {
            name: "guided-counselor",
            display_name: "Guided Counselor",
            description: "Work through it together.",
            order: 30,
            default: false,
          },
        ],
        max_selected_skills: 3,
      },
    });

    expect(config.skills).toEqual([]);
    expect(config.maxSelectedSkills).toBe(0);
    expect(config.skillModes).toHaveLength(3);
    expect(config.defaultSkillMode?.skillName).toBe("focused-answer");
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

  it("degrades malformed modes without disabling ordinary skills", () => {
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
        skill_modes: [
          {
            name: "focused-answer",
            display_name: "Focused Answer",
            description: "Clear, direct help.",
            order: 10,
            default: true,
          },
          {
            name: "focused-answer",
            display_name: "Duplicate",
            description: "Duplicate name.",
            order: 20,
            default: false,
          },
          {
            name: "guided-counselor",
            display_name: "Guided Counselor",
            description: "Work through it together.",
            order: 30,
            default: false,
          },
        ],
        max_selected_skills: 3,
      },
    });

    expect(config.skills).toEqual([
      {
        name: "school-comparison",
        displayName: "School comparison",
        description: "Compare schools side by side.",
      },
    ]);
    expect(config.maxSelectedSkills).toBe(3);
    expect(config.skillModes).toEqual([]);
    expect(config.defaultSkillMode).toBeNull();
  });

  it.each([
    { name: "missing mode key", skill_modes: undefined },
    { name: "wrong count", skill_modes: [] },
    {
      name: "duplicate order",
      skill_modes: [
        {
          name: "focused-answer",
          display_name: "Focused Answer",
          description: "Clear, direct help.",
          order: 10,
          default: true,
        },
        {
          name: "deep-research",
          display_name: "Deep Research",
          description: "Investigate carefully.",
          order: 10,
          default: false,
        },
        {
          name: "guided-counselor",
          display_name: "Guided Counselor",
          description: "Work through it together.",
          order: 30,
          default: false,
        },
      ],
    },
    {
      name: "unsupported mode name",
      skill_modes: [
        {
          name: "focused-answer",
          display_name: "Focused Answer",
          description: "Clear, direct help.",
          order: 10,
          default: true,
        },
        {
          name: "deep-research",
          display_name: "Deep Research",
          description: "Investigate carefully.",
          order: 20,
          default: false,
        },
        {
          name: "made-up-mode",
          display_name: "Made Up",
          description: "Should not be shown.",
          order: 30,
          default: false,
        },
      ],
    },
    {
      name: "negative order",
      skill_modes: [
        {
          name: "focused-answer",
          display_name: "Focused Answer",
          description: "Clear, direct help.",
          order: -1,
          default: true,
        },
        {
          name: "deep-research",
          display_name: "Deep Research",
          description: "Investigate carefully.",
          order: 20,
          default: false,
        },
        {
          name: "guided-counselor",
          display_name: "Guided Counselor",
          description: "Work through it together.",
          order: 30,
          default: false,
        },
      ],
    },
    {
      name: "swapped order",
      skill_modes: [
        {
          name: "focused-answer",
          display_name: "Focused Answer",
          description: "Clear, direct help.",
          order: 30,
          default: true,
        },
        {
          name: "deep-research",
          display_name: "Deep Research",
          description: "Investigate carefully.",
          order: 20,
          default: false,
        },
        {
          name: "guided-counselor",
          display_name: "Guided Counselor",
          description: "Work through it together.",
          order: 10,
          default: false,
        },
      ],
    },
    {
      name: "missing default",
      skill_modes: [
        {
          name: "focused-answer",
          display_name: "Focused Answer",
          description: "Clear, direct help.",
          order: 10,
          default: false,
        },
        {
          name: "deep-research",
          display_name: "Deep Research",
          description: "Investigate carefully.",
          order: 20,
          default: false,
        },
        {
          name: "guided-counselor",
          display_name: "Guided Counselor",
          description: "Work through it together.",
          order: 30,
          default: false,
        },
      ],
    },
    {
      name: "wrong default mode",
      skill_modes: [
        {
          name: "focused-answer",
          display_name: "Focused Answer",
          description: "Clear, direct help.",
          order: 10,
          default: false,
        },
        {
          name: "deep-research",
          display_name: "Deep Research",
          description: "Investigate carefully.",
          order: 20,
          default: true,
        },
        {
          name: "guided-counselor",
          display_name: "Guided Counselor",
          description: "Work through it together.",
          order: 30,
          default: false,
        },
      ],
    },
    {
      name: "multiple defaults",
      skill_modes: [
        {
          name: "focused-answer",
          display_name: "Focused Answer",
          description: "Clear, direct help.",
          order: 10,
          default: true,
        },
        {
          name: "deep-research",
          display_name: "Deep Research",
          description: "Investigate carefully.",
          order: 20,
          default: true,
        },
        {
          name: "guided-counselor",
          display_name: "Guided Counselor",
          description: "Work through it together.",
          order: 30,
          default: false,
        },
      ],
    },
  ])("hides invalid optional mode config: $name", ({ skill_modes }) => {
    const config = resolveComposerConfig({
      status: "success",
      config: {
        greeting: "Welcome",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
        skill_modes,
      },
    });

    expect(config.skillModes).toEqual([]);
    expect(config.defaultSkillMode).toBeNull();
  });

  it("does not mutate the incoming mode array while sorting", () => {
    const skillModes = [
      {
        name: "guided-counselor",
        display_name: "Guided Counselor",
        description: "Work through it together.",
        order: 30,
        default: false,
      },
      {
        name: "focused-answer",
        display_name: "Focused Answer",
        description: "Clear, direct help.",
        order: 10,
        default: true,
      },
      {
        name: "deep-research",
        display_name: "Deep Research",
        description: "Investigate carefully.",
        order: 20,
        default: false,
      },
    ];

    resolveComposerConfig({
      status: "success",
      config: {
        greeting: "Welcome",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
        skill_modes: skillModes,
      },
    });

    expect(skillModes.map((mode) => mode.name)).toEqual([
      "guided-counselor",
      "focused-answer",
      "deep-research",
    ]);
  });
});
