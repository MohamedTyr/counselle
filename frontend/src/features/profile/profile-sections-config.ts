import type { SectionConfig } from "@/features/profile/profile-field-types"

function summarize(item: Record<string, unknown>, ...keys: string[]): string {
  const parts = keys
    .map((key) => item[key])
    .filter((value): value is string | number => value !== null && value !== undefined && value !== "")
  return parts.length > 0 ? parts.join(" — ") : "New entry"
}

export const PROFILE_SECTIONS: readonly SectionConfig[] = [
  {
    key: "basics",
    title: "Basics",
    description: "Who you are and where you go to school.",
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
      { kind: "int", key: "graduation_year", label: "Graduation year" },
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
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "academics",
    title: "Academics",
    description: "Grades, rigor, and how your record reads.",
    fields: [
      { kind: "decimal", key: "gpa_unweighted", label: "GPA (unweighted)" },
      { kind: "decimal", key: "gpa_weighted", label: "GPA (weighted)" },
      { kind: "decimal", key: "gpa_scale", label: "GPA scale" },
      { kind: "int", key: "class_rank", label: "Class rank" },
      { kind: "int", key: "class_size", label: "Class size" },
      { kind: "boolean", key: "school_ranks", label: "School ranks students" },
      {
        kind: "object",
        key: "grade_trend",
        label: "Grade trend",
        fields: [
          {
            kind: "select",
            key: "trend",
            label: "Trend",
            options: [
              { label: "Upward", value: "upward" },
              { label: "Flat", value: "flat" },
              { label: "Dip", value: "dip" },
            ],
          },
          { kind: "textarea", key: "why", label: "Why" },
        ],
      },
      {
        kind: "string-list",
        key: "current_courses",
        label: "Current courses",
        placeholder: "AP Calc BC, AP Physics C, ...",
      },
      { kind: "textarea", key: "rigor_summary", label: "Rigor summary" },
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "testing",
    title: "Testing",
    description: "Scores taken and planned.",
    fields: [
      {
        kind: "object",
        key: "sat",
        label: "SAT",
        fields: [
          { kind: "int", key: "total", label: "Total" },
          { kind: "int", key: "ebrw", label: "EBRW" },
          { kind: "int", key: "math", label: "Math" },
          { kind: "date", key: "date", label: "Date" },
        ],
      },
      {
        kind: "object",
        key: "act",
        label: "ACT",
        fields: [
          { kind: "int", key: "composite", label: "Composite" },
          { kind: "date", key: "date", label: "Date" },
        ],
      },
      {
        kind: "object",
        key: "psat",
        label: "PSAT",
        fields: [
          { kind: "int", key: "total", label: "Total" },
          { kind: "text", key: "nmsqt_status", label: "NMSQT status" },
        ],
      },
      {
        kind: "object",
        key: "ib",
        label: "IB",
        fields: [
          { kind: "text", key: "programme", label: "Programme" },
          { kind: "decimal", key: "predicted", label: "Predicted score" },
          { kind: "decimal", key: "final", label: "Final score" },
        ],
      },
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
      {
        kind: "object-list",
        key: "ap_scores",
        label: "AP scores",
        addLabel: "Add AP score",
        itemFields: [
          { kind: "text", key: "subject", label: "Subject", required: true },
          { kind: "int", key: "score", label: "Score", required: true },
        ],
        itemSummary: (item) => summarize(item, "subject", "score"),
      },
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "background",
    title: "Background",
    description: "Citizenship, residence, and context that shapes review.",
    fields: [
      { kind: "text", key: "citizenship", label: "Citizenship" },
      { kind: "text", key: "visa_status", label: "Visa status" },
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
      { kind: "boolean", key: "first_gen", label: "First-generation student" },
      { kind: "textarea", key: "family_education", label: "Family education" },
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
      {
        kind: "string-list",
        key: "languages",
        label: "Languages",
        placeholder: "English, Spanish, ...",
      },
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
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "circumstances",
    title: "Circumstances",
    description: "Anything that shaped your record and deserves context.",
    fields: [
      { kind: "textarea", key: "disruptions", label: "Disruptions" },
      { kind: "textarea", key: "responsibilities", label: "Responsibilities" },
      { kind: "textarea", key: "health_learning", label: "Health & learning" },
      { kind: "textarea", key: "disciplinary", label: "Disciplinary" },
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "aid",
    title: "Aid",
    description: "Financial-aid posture and constraints.",
    fields: [
      { kind: "boolean", key: "need_aid", label: "Needs aid" },
      { kind: "decimal", key: "budget_per_year", label: "Budget per year" },
      { kind: "decimal", key: "sai_estimate", label: "SAI estimate" },
      { kind: "textarea", key: "css_complexity", label: "CSS complexity" },
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
      { kind: "boolean", key: "merit_priority", label: "Merit is a priority" },
      {
        kind: "boolean",
        key: "applying_for_scholarships",
        label: "Applying for scholarships",
      },
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "interests",
    title: "Interests",
    description: "Majors and career direction.",
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
        label: "Major certainty",
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
      { kind: "textarea", key: "career_direction", label: "Career direction" },
      {
        kind: "multi-select",
        key: "preprofessional",
        label: "Preprofessional tracks",
        options: [
          { label: "Pre-med", value: "pre_med" },
          { label: "Pre-law", value: "pre_law" },
          { label: "BS/MD", value: "bs_md" },
          { label: "Nursing", value: "nursing" },
          { label: "Engineering (ABET)", value: "engineering_accreditation" },
          { label: "Other", value: "other" },
        ],
      },
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "preferences",
    title: "Preferences",
    description: "What you're looking for in a school.",
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
      { kind: "textarea", key: "campus_culture", label: "Campus culture" },
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
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "narrative",
    title: "Narrative",
    description: "The story your application is telling.",
    fields: [
      { kind: "textarea", key: "spike", label: "Spike" },
      {
        kind: "textarea",
        key: "defining_experiences",
        label: "Defining experiences",
      },
      { kind: "textarea", key: "self_description", label: "Self-description" },
      {
        kind: "textarea",
        key: "values_motivations",
        label: "Values & motivations",
      },
      { kind: "textarea", key: "essay_angles", label: "Essay angles" },
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
  {
    key: "people",
    title: "People",
    description: "Recommenders and support around your application.",
    fields: [
      {
        kind: "object-list",
        key: "recommenders",
        label: "Recommenders",
        addLabel: "Add recommender",
        itemFields: [
          { kind: "text", key: "name", label: "Name", required: true },
          { kind: "text", key: "role_or_subject", label: "Role / subject" },
          { kind: "text", key: "why_them", label: "Why them" },
        ],
        itemSummary: (item) => summarize(item, "name", "role_or_subject"),
      },
      { kind: "textarea", key: "counselor_context", label: "Counselor context" },
      { kind: "textarea", key: "family_stance", label: "Family stance" },
      { kind: "textarea", key: "other_support", label: "Other support" },
      { kind: "textarea", key: "notes", label: "Notes" },
    ],
  },
]
