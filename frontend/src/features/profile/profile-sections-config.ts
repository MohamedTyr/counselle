import type {
  ScalarFieldConfig,
  SectionConfig,
  SectionGroupKey,
} from "@/features/profile/profile-field-types";

function summarize(item: Record<string, unknown>, ...keys: string[]): string {
  const parts = keys
    .map((key) => item[key])
    .filter(
      (value): value is string | number =>
        value !== null && value !== undefined && value !== "",
    )
    .map((value) =>
      typeof value === "string" ? value.replaceAll("_", " ") : value,
    );
  return parts.length > 0 ? parts.join(" — ") : "New entry";
}

/** Every section ends with the same free-text `notes` leaf. It lives here
 * rather than in each section's groups because it is always last, always the
 * largest control, and — left in the grid — always the thing the section
 * looks like. The panel renders it behind an "Add a note" disclosure. */
export const PROFILE_NOTE_FIELD: ScalarFieldConfig = {
  kind: "textarea",
  key: "notes",
  label: "Notes",
};

/** The rail's three groups, in order. The third group's label is about
 * timing: its sections are not behind, they are not due yet — hence `note`,
 * which says so in the counselor's voice instead of leaving two permanently
 * empty rows to read as a backlog. */
export const PROFILE_SECTION_GROUPS: readonly {
  key: SectionGroupKey;
  label: string;
  note?: string;
}[] = [
  { key: "advice", label: "Changes the advice" },
  { key: "read", label: "Changes the read" },
  {
    key: "writing",
    label: "For when you start writing",
    note: "Most students leave these two empty until junior spring.",
  },
];

export const PROFILE_SECTIONS: readonly SectionConfig[] = [
  {
    key: "basics",
    title: "Basics",
    group: "advice",
    description: "Who you are and where you go to school.",
    matters: "Sets the timeline every deadline answer is measured against.",
    groups: [
      {
        label: "You",
        fields: [
          { kind: "text", key: "preferred_name", label: "Preferred name" },
          { kind: "text", key: "pronouns", label: "Pronouns" },
          {
            kind: "select",
            key: "grade_level",
            label: "Grade level",
            options: [
              { label: "9th", value: "9" },
              { label: "10th", value: "10" },
              { label: "11th", value: "11" },
              { label: "12th", value: "12" },
              { label: "Gap year", value: "gap" },
              { label: "Other", value: "other" },
            ],
          },
          {
            kind: "int",
            key: "graduation_year",
            label: "Graduation year",
            min: 2000,
            max: 2100,
          },
        ],
      },
      {
        label: "High school",
        fields: [
          {
            kind: "object",
            key: "high_school",
            label: "High school",
            fields: [
              { kind: "text", key: "name", label: "School name" },
              {
                kind: "select",
                key: "type",
                label: "Type",
                options: [
                  { label: "Public", value: "public" },
                  { label: "Charter", value: "charter" },
                  { label: "Magnet", value: "magnet" },
                  { label: "Private", value: "private" },
                  { label: "Parochial", value: "parochial" },
                  { label: "Homeschool", value: "homeschool" },
                  { label: "International", value: "international" },
                ],
              },
              { kind: "text", key: "city", label: "City" },
              { kind: "text", key: "state", label: "State" },
              { kind: "text", key: "country", label: "Country" },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "academics",
    title: "Academics",
    group: "advice",
    description:
      "Grades, rigor, and how your record reads. This is what Counselle uses to say where you would be competitive.",
    matters:
      "Counselle can't say where you'd be competitive without a GPA or a score.",
    groups: [
      {
        label: "Grades",
        fields: [
          {
            kind: "decimal",
            key: "gpa_unweighted",
            label: "GPA, unweighted",
            min: 0,
            help: "Use the scale your school reports.",
          },
          {
            kind: "decimal",
            key: "gpa_weighted",
            label: "GPA, weighted",
            min: 0,
          },
          {
            kind: "decimal",
            key: "gpa_scale",
            label: "Scale",
            min: 0,
            help: "For example, 4.0 or 5.0.",
          },
        ],
      },
      {
        label: "Class rank",
        fields: [
          { kind: "int", key: "class_rank", label: "Rank", min: 1 },
          { kind: "int", key: "class_size", label: "Class size", min: 1 },
          {
            kind: "boolean",
            key: "school_ranks",
            label: "School ranks students",
          },
        ],
      },
      {
        label: "Trajectory",
        fields: [
          {
            kind: "object",
            key: "grade_trend",
            label: "Grade trend",
            fields: [
              {
                kind: "select",
                key: "trend",
                label: "Grade trend",
                options: [
                  { label: "Upward", value: "upward" },
                  { label: "Flat", value: "flat" },
                  { label: "Dip", value: "dip" },
                ],
              },
              { kind: "textarea", key: "why", label: "What happened" },
            ],
          },
        ],
      },
      {
        label: "Coursework",
        fields: [
          {
            kind: "string-list",
            key: "current_courses",
            label: "Current courses",
            placeholder: "AP Calc BC, AP Physics C, ...",
          },
          {
            kind: "textarea",
            key: "rigor_summary",
            label: "How your school's rigor works",
          },
        ],
      },
    ],
  },
  {
    key: "testing",
    title: "Testing",
    group: "advice",
    description: "Scores taken and planned.",
    matters: "Score strategy depends on what you've already sat.",
    groups: [
      {
        label: "SAT",
        fields: [
          {
            kind: "object",
            key: "sat",
            label: "SAT",
            fields: [
              {
                kind: "int",
                key: "total",
                label: "Total",
                min: 400,
                max: 1600,
              },
              { kind: "int", key: "ebrw", label: "EBRW", min: 200, max: 800 },
              { kind: "int", key: "math", label: "Math", min: 200, max: 800 },
              { kind: "date", key: "date", label: "Date" },
            ],
          },
        ],
      },
      {
        label: "ACT",
        fields: [
          {
            kind: "object",
            key: "act",
            label: "ACT",
            fields: [
              {
                kind: "int",
                key: "composite",
                label: "Composite",
                min: 1,
                max: 36,
              },
              { kind: "date", key: "date", label: "Date" },
            ],
          },
        ],
      },
      {
        label: "PSAT",
        fields: [
          {
            kind: "object",
            key: "psat",
            label: "PSAT",
            fields: [
              {
                kind: "int",
                key: "total",
                label: "Total",
                min: 320,
                max: 1520,
              },
              { kind: "text", key: "nmsqt_status", label: "NMSQT status" },
            ],
          },
        ],
      },
      {
        label: "IB",
        fields: [
          {
            kind: "object",
            key: "ib",
            label: "IB",
            fields: [
              { kind: "text", key: "programme", label: "Programme" },
              {
                kind: "decimal",
                key: "predicted",
                label: "Predicted score",
                min: 0,
                max: 45,
              },
              {
                kind: "decimal",
                key: "final",
                label: "Final score",
                min: 0,
                max: 45,
              },
            ],
          },
        ],
      },
      {
        label: "English proficiency",
        fields: [
          {
            kind: "object",
            key: "english_proficiency",
            label: "English proficiency",
            fields: [
              { kind: "text", key: "test", label: "Test" },
              { kind: "text", key: "score", label: "Score" },
              { kind: "date", key: "date", label: "Date" },
            ],
          },
        ],
      },
      {
        label: "AP scores",
        fields: [
          {
            kind: "object-list",
            key: "ap_scores",
            label: "AP scores",
            addLabel: "Add AP score",
            itemFields: [
              {
                kind: "text",
                key: "subject",
                label: "Subject",
                required: true,
              },
              {
                kind: "int",
                key: "score",
                label: "Score",
                min: 1,
                max: 5,
                required: true,
              },
            ],
            itemSummary: (item) => summarize(item, "subject", "score"),
          },
        ],
      },
      {
        label: "Planned tests",
        fields: [
          {
            kind: "object-list",
            key: "planned_tests",
            label: "Planned tests",
            addLabel: "Add planned test",
            itemFields: [
              { kind: "text", key: "test", label: "Test", required: true },
              { kind: "date", key: "date", label: "Date" },
            ],
            itemSummary: (item) => summarize(item, "test", "date"),
          },
        ],
      },
    ],
  },
  {
    key: "interests",
    title: "Interests",
    group: "advice",
    description: "Majors and career direction.",
    matters: "Changes which programs are worth comparing at all.",
    groups: [
      {
        label: "Major",
        fields: [
          {
            kind: "string-list",
            key: "intended_majors",
            label: "Intended majors",
            placeholder: "Computer science, ...",
          },
          {
            kind: "select",
            key: "major_certainty",
            label: "How settled",
            options: [
              { label: "Locked", value: "locked" },
              { label: "Leaning", value: "leaning" },
              { label: "Exploring", value: "exploring" },
            ],
          },
          {
            kind: "string-list",
            key: "alternate_majors",
            label: "Alternate majors",
            placeholder: "Biology, economics, ...",
          },
        ],
      },
      {
        label: "Direction",
        fields: [
          {
            kind: "textarea",
            key: "career_direction",
            label: "Career direction",
          },
          {
            kind: "multi-select",
            key: "preprofessional",
            label: "Preprofessional tracks",
            options: [
              { label: "Pre-med", value: "pre_med" },
              { label: "Pre-law", value: "pre_law" },
              { label: "BS/MD", value: "bs_md" },
              { label: "Nursing", value: "nursing" },
              {
                label: "Engineering (ABET)",
                value: "engineering_accreditation",
              },
              { label: "Other", value: "other" },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "preferences",
    title: "Preferences",
    group: "advice",
    description: "What you're looking for in a school.",
    matters: "Without these, Counselle suggests schools on numbers alone.",
    groups: [
      {
        label: "Place",
        fields: [
          {
            kind: "string-list",
            key: "regions",
            label: "Regions",
            placeholder: "Northeast, West Coast, ...",
          },
          {
            kind: "text",
            key: "max_distance_from_home",
            label: "Max distance from home",
          },
          { kind: "text", key: "climate", label: "Climate" },
        ],
      },
      {
        label: "Campus",
        fields: [
          {
            kind: "multi-select",
            key: "sizes",
            label: "Sizes",
            options: [
              { label: "Small", value: "small" },
              { label: "Medium", value: "medium" },
              { label: "Large", value: "large" },
            ],
          },
          {
            kind: "multi-select",
            key: "settings",
            label: "Settings",
            options: [
              { label: "Urban", value: "urban" },
              { label: "Suburban", value: "suburban" },
              { label: "College town", value: "college_town" },
              { label: "Rural", value: "rural" },
            ],
          },
          {
            kind: "textarea",
            key: "campus_culture",
            label: "Campus culture",
          },
        ],
      },
      {
        label: "Lines you'd draw",
        fields: [
          {
            kind: "string-list",
            key: "must_haves",
            label: "Must-haves",
            placeholder: "Division I athletics, ...",
          },
          {
            kind: "string-list",
            key: "dealbreakers",
            label: "Dealbreakers",
            placeholder: "No Greek life, ...",
          },
        ],
      },
    ],
  },
  {
    key: "background",
    title: "Background",
    group: "read",
    description: "Citizenship, residence, and context that shapes review.",
    matters: "Changes how an admissions reader reads the same record.",
    groups: [
      {
        label: "Citizenship",
        fields: [
          { kind: "text", key: "citizenship", label: "Citizenship" },
          { kind: "text", key: "visa_status", label: "Visa status" },
        ],
      },
      {
        label: "Residence",
        fields: [
          {
            kind: "object",
            key: "residence",
            label: "Residence",
            fields: [
              { kind: "text", key: "city", label: "City" },
              { kind: "text", key: "state", label: "State" },
              { kind: "text", key: "country", label: "Country" },
            ],
          },
        ],
      },
      {
        label: "Community",
        fields: [
          {
            kind: "select",
            key: "community_type",
            label: "Community type",
            options: [
              { label: "Rural", value: "rural" },
              { label: "Small town", value: "small_town" },
              { label: "Suburban", value: "suburban" },
              { label: "Urban", value: "urban" },
            ],
          },
          {
            kind: "string-list",
            key: "languages",
            label: "Languages",
            placeholder: "English, Spanish, ...",
          },
        ],
      },
      {
        label: "Family",
        fields: [
          {
            kind: "boolean",
            key: "first_gen",
            label: "First-generation student",
          },
          {
            kind: "textarea",
            key: "family_education",
            label: "Family education",
          },
        ],
      },
      {
        label: "Hooks",
        fields: [
          {
            kind: "object-list",
            key: "hooks",
            label: "Hooks",
            addLabel: "Add hook",
            itemFields: [
              {
                kind: "select",
                key: "kind",
                label: "Kind",
                options: [
                  { label: "Legacy", value: "legacy" },
                  { label: "Recruited athlete", value: "recruited_athlete" },
                  { label: "Development", value: "development" },
                  { label: "Faculty child", value: "faculty_child" },
                  { label: "Tribal", value: "tribal" },
                  { label: "Military family", value: "military_family" },
                  { label: "QuestBridge/Posse", value: "questbridge_posse" },
                  { label: "Other", value: "other" },
                ],
              },
              { kind: "text", key: "detail", label: "Detail" },
            ],
            itemSummary: (item) => summarize(item, "kind", "detail"),
          },
        ],
      },
    ],
  },
  {
    key: "circumstances",
    title: "Circumstances",
    group: "read",
    description: "Anything that shaped your record and deserves context.",
    matters: "Explains a dip or a gap that would otherwise read as a choice.",
    groups: [
      {
        label: "What shaped your record",
        fields: [
          { kind: "textarea", key: "disruptions", label: "Disruptions" },
          {
            kind: "textarea",
            key: "responsibilities",
            label: "Responsibilities",
          },
          {
            kind: "textarea",
            key: "health_learning",
            label: "Health & learning",
          },
        ],
      },
      {
        label: "Disciplinary",
        fields: [
          { kind: "textarea", key: "disciplinary", label: "Disciplinary" },
        ],
      },
    ],
  },
  {
    key: "aid",
    title: "Aid",
    group: "read",
    description: "Financial-aid posture and constraints.",
    matters: "Without it, cost answers are list prices, not your price.",
    groups: [
      {
        label: "Need",
        fields: [
          { kind: "boolean", key: "need_aid", label: "Needs aid" },
          {
            kind: "decimal",
            key: "budget_per_year",
            label: "Budget per year",
          },
          { kind: "decimal", key: "sai_estimate", label: "SAI estimate" },
        ],
      },
      {
        label: "Approach",
        fields: [
          {
            kind: "select",
            key: "loan_appetite",
            label: "Loan appetite",
            options: [
              { label: "None", value: "none" },
              { label: "Limited", value: "limited" },
              { label: "Open", value: "open" },
            ],
          },
          {
            kind: "boolean",
            key: "merit_priority",
            label: "Merit is a priority",
          },
          {
            kind: "boolean",
            key: "applying_for_scholarships",
            label: "Applying for scholarships",
          },
          {
            kind: "textarea",
            key: "css_complexity",
            label: "CSS complexity",
          },
        ],
      },
    ],
  },
  {
    key: "narrative",
    title: "Narrative",
    group: "writing",
    description: "The story your application is telling.",
    matters: "Feeds essay work when you get to it.",
    groups: [
      {
        label: "Your through-line",
        fields: [
          { kind: "textarea", key: "spike", label: "Spike" },
          {
            kind: "textarea",
            key: "defining_experiences",
            label: "Defining experiences",
          },
        ],
      },
      {
        label: "Voice",
        fields: [
          {
            kind: "textarea",
            key: "self_description",
            label: "Self-description",
          },
          {
            kind: "textarea",
            key: "values_motivations",
            label: "Values & motivations",
          },
        ],
      },
      {
        label: "Essays",
        fields: [
          { kind: "textarea", key: "essay_angles", label: "Essay angles" },
        ],
      },
    ],
  },
  {
    key: "people",
    title: "People",
    group: "writing",
    description: "Recommenders and support around your application.",
    matters: "Who writes for you, and who is around you while you apply.",
    groups: [
      {
        label: "Recommenders",
        fields: [
          {
            kind: "object-list",
            key: "recommenders",
            label: "Recommenders",
            addLabel: "Add recommender",
            itemFields: [
              { kind: "text", key: "name", label: "Name", required: true },
              {
                kind: "text",
                key: "role_or_subject",
                label: "Role / subject",
              },
              { kind: "text", key: "why_them", label: "Why them" },
              { kind: "boolean", key: "asked", label: "Asked?" },
            ],
            itemSummary: (item) => summarize(item, "name", "role_or_subject"),
          },
        ],
      },
      {
        label: "Support",
        fields: [
          {
            kind: "textarea",
            key: "counselor_context",
            label: "Counselor context",
          },
          { kind: "textarea", key: "family_stance", label: "Family stance" },
          { kind: "textarea", key: "other_support", label: "Other support" },
        ],
      },
    ],
  },
];
