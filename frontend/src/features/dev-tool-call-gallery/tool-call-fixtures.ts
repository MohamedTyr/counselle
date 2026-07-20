import type { StepData, StepKind, StepTier } from "@/api/chat/types";

export type ToolCallFixture = Readonly<{
  id: string;
  group:
    "School data" | "Search" | "Workspace reads" | "Other reads" | "Writes";
  tool: string;
  step: StepData;
  live?: boolean;
  plan?: boolean;
  note?: string;
}>;

type FixtureInput = Readonly<{
  group: ToolCallFixture["group"];
  tool: string;
  label: string;
  status?: StepData["status"];
  tier?: StepTier;
  detail?: NonNullable<StepData["detail"]>;
  sources?: StepData["sources"];
  live?: boolean;
  plan?: boolean;
  note?: string;
  ui?: StepData["ui"];
  kind?: StepKind;
}>;

const TOOL_KINDS: Readonly<Record<string, StepKind>> = Object.freeze({
  resolve_school: "db_tool",
  get_school_profile: "db_tool",
  get_domain: "db_tool",
  read_tool_result: "db_tool",
  query_database: "sql",
  search_web: "web_search",
  search_school_site: "edu_search",
  search_reddit: "reddit_search",
  render_viz: "viz",
  load_skill: "skill",
  write_plan: "write_plan",
  remember: "memory",
  update_memory: "memory",
  forget: "memory",
});

function kindForTool(tool: string): StepKind {
  return (
    TOOL_KINDS[tool] ?? (tool === "future_tool" ? "future_kind" : "workspace")
  );
}

function fixture(input: FixtureInput): ToolCallFixture {
  const status = input.status ?? "end";
  return Object.freeze({
    id: `${input.tool}-${status}-${input.label}`,
    group: input.group,
    tool: input.tool,
    live: input.live,
    plan: input.plan,
    note: input.note,
    step: Object.freeze({
      step_id: `${input.tool}-${status}`,
      status,
      kind: input.kind ?? kindForTool(input.tool),
      label: input.label,
      tier: input.tier ?? null,
      tool: input.tool,
      detail: input.detail ?? null,
      sources: input.sources,
      ui: input.ui,
    }),
  });
}

const schoolDataFixtures: readonly ToolCallFixture[] = [
  fixture({
    group: "School data",
    tool: "resolve_school",
    label: "Finding “Yale”…",
    status: "start",
    tier: "official",
    live: true,
    note: "Running",
  }),
  fixture({
    group: "School data",
    tool: "resolve_school",
    label: "Found Yale University",
    tier: "official",
    detail: { result_count: 1 },
    note: "One match",
  }),
  fixture({
    group: "School data",
    tool: "resolve_school",
    label: "Found possible matches for “UC”",
    tier: "official",
    detail: { result_count: 9 },
    note: "Ambiguous",
  }),
  fixture({
    group: "School data",
    tool: "resolve_school",
    label: "No school found for “Atlantis College”",
    tier: "official",
    detail: { result_count: 0 },
    note: "Unavailable",
  }),
  fixture({
    group: "School data",
    tool: "resolve_school",
    label: "Couldn’t search the school database",
    status: "error",
    tier: "official",
    detail: { error: "School lookup failed" },
    note: "Error",
  }),
  fixture({
    group: "School data",
    tool: "get_school_profile",
    label: "Read Massachusetts Institute of Technology’s profile",
    tier: "official",
    detail: { value_count: 18 },
    note: "Complete",
  }),
  fixture({
    group: "School data",
    tool: "get_school_profile",
    label: "Profile data unavailable for Cooper Union",
    tier: "official",
    detail: { value_count: 0 },
    note: "Unavailable",
  }),
  fixture({
    group: "School data",
    tool: "get_domain",
    label: "Reading Stanford University’s admissions data…",
    status: "start",
    tier: "official",
    live: true,
    note: "Running",
  }),
  fixture({
    group: "School data",
    tool: "get_domain",
    label: "Read Stanford University’s admissions data",
    tier: "official",
    detail: { value_count: 72, domain_id: "admissions" },
    note: "Complete",
  }),
  fixture({
    group: "School data",
    tool: "get_domain",
    label: "Couldn’t read Stanford University’s financial aid data",
    status: "error",
    tier: "official",
    detail: { error: "Domain unavailable" },
    note: "Error",
  }),
];

const searchFixtures: readonly ToolCallFixture[] = [
  fixture({
    group: "Search",
    tool: "search_web",
    label: "Searching the web: “Stanford acceptance rate class of 2028”",
    status: "start",
    live: true,
    detail: { query: "Stanford acceptance rate class of 2028" },
    note: "Running",
  }),
  fixture({
    group: "Search",
    tool: "search_web",
    label: "Searching the web: “Stanford acceptance rate class of 2028”",
    detail: {
      query: "Stanford acceptance rate class of 2028",
      result_count: 8,
    },
    sources: [
      {
        label: "stanford.edu",
        title: "Undergraduate admission statistics",
        url: "https://admission.stanford.edu/apply/selection/statistics.html",
        favicon: "https://www.google.com/s2/favicons?domain=stanford.edu&sz=32",
      },
      {
        label: "stanforddaily.com",
        title: "Stanford admits the Class of 2028",
        url: "https://stanforddaily.com/class-of-2028",
        favicon:
          "https://www.google.com/s2/favicons?domain=stanforddaily.com&sz=32",
      },
      {
        label: "commonapp.org",
        title: "Stanford University application profile",
        url: "https://www.commonapp.org/explore/stanford-university",
        favicon:
          "https://www.google.com/s2/favicons?domain=commonapp.org&sz=32",
      },
      {
        label: "collegeboard.org",
        title: "Stanford admissions and enrollment",
        url: "https://bigfuture.collegeboard.org/colleges/stanford-university",
        favicon:
          "https://www.google.com/s2/favicons?domain=collegeboard.org&sz=32",
      },
      {
        label: "stanford.edu",
        title: "Common Data Set 2023–24",
        url: "https://irds.stanford.edu/common-data-set",
        favicon: "https://www.google.com/s2/favicons?domain=stanford.edu&sz=32",
      },
    ],
    note: "Open web",
  }),
  fixture({
    group: "Search",
    tool: "search_web",
    label: "Searching the web — source unavailable",
    status: "error",
    detail: { query: "Stanford acceptance rate", error: "Search failed" },
    note: "Error",
  }),
  fixture({
    group: "Search",
    tool: "search_school_site",
    label: "Searching Stanford University’s website: “common data set”",
    tier: "official",
    detail: {
      query: "common data set",
      result_count: 8,
      domains: ["irds.stanford.edu"],
    },
    sources: [
      {
        label: "irds.stanford.edu",
        title: "Stanford Common Data Set",
        url: "https://irds.stanford.edu/data-findings/cds",
        favicon:
          "https://www.google.com/s2/favicons?domain=irds.stanford.edu&sz=32",
      },
      {
        label: "irds.stanford.edu",
        title: "Common Data Set 2023–2024",
        url: "https://irds.stanford.edu/cds-2024",
        favicon:
          "https://www.google.com/s2/favicons?domain=irds.stanford.edu&sz=32",
      },
      {
        label: "admission.stanford.edu",
        title: "Undergraduate admission profile",
        url: "https://admission.stanford.edu/apply/",
        favicon:
          "https://www.google.com/s2/favicons?domain=admission.stanford.edu&sz=32",
      },
      {
        label: "facts.stanford.edu",
        title: "Stanford facts and enrollment",
        url: "https://facts.stanford.edu/academics/undergraduate-profile/",
        favicon:
          "https://www.google.com/s2/favicons?domain=facts.stanford.edu&sz=32",
      },
    ],
    note: "Official site",
  }),
  fixture({
    group: "Search",
    tool: "search_reddit",
    label: "Checking r/ApplyingToCollege and r/college",
    tier: "community",
    detail: { query: "Stanford campus culture", result_count: 6 },
    sources: [
      {
        label: "What surprised you most about Stanford?",
        title: "What surprised you most about Stanford?",
        url: "https://reddit.com/r/stanford/example-1",
        favicon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32",
      },
      {
        label: "Honest thoughts on campus culture",
        title: "Honest thoughts on campus culture",
        url: "https://reddit.com/r/ApplyingToCollege/example-2",
        favicon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32",
      },
      {
        label: "Stanford student life AMA",
        title: "Stanford student life AMA",
        url: "https://reddit.com/r/stanford/example-3",
        favicon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32",
      },
      {
        label: "Choosing Stanford over peer schools",
        title: "Choosing Stanford over peer schools",
        url: "https://reddit.com/r/ApplyingToCollege/example-4",
        favicon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32",
      },
    ],
    note: "Community",
  }),
];

const workspaceReadFixtures: readonly ToolCallFixture[] = [
  fixture({
    group: "Workspace reads",
    tool: "view_tasks",
    label: "Checking the task list",
    detail: {
      summary: "4 active tasks · 2 due soon",
      result_count: 4,
      workspace_items: [
        {
          kind: "task",
          title: "Submit FAFSA",
          meta: [{ label: "Due", value: "2026-01-31" }],
          status: "doing",
        },
        {
          kind: "task",
          title: "Request counselor recommendation",
          meta: [{ label: "Due", value: "2026-02-04" }],
          status: "todo",
        },
        {
          kind: "task",
          title: "Review Stanford financial aid offer",
          meta: [{ label: "Category", value: "financial_aid" }],
          status: "waiting",
        },
        {
          kind: "task",
          title: "Upload midyear transcript",
          meta: [],
          status: "todo",
        },
      ],
    },
    note: "Complete",
  }),
  fixture({
    group: "Workspace reads",
    tool: "search_tasks",
    label: "Searching tasks for “financial aid”",
    detail: {
      query: "financial aid",
      summary: "3 matching tasks",
      result_count: 3,
      workspace_items: [
        {
          kind: "task",
          title: "Submit FAFSA",
          meta: [{ label: "Due", value: "2026-01-31" }],
          status: "doing",
        },
        {
          kind: "task",
          title: "Review aid offer",
          meta: [{ label: "Category", value: "financial_aid" }],
          status: "waiting",
        },
        {
          kind: "task",
          title: "Complete CSS Profile",
          meta: [],
          status: "done",
        },
      ],
    },
    note: "Matches",
  }),
  fixture({
    group: "Workspace reads",
    tool: "search_schools",
    label: "Searching colleges for “engineering”",
    detail: {
      query: "engineering",
      summary: "4 colleges matched",
      result_count: 4,
      workspace_items: [
        {
          kind: "school",
          title: "Massachusetts Institute of Technology",
          meta: [{ label: "Location", value: "Cambridge, MA" }],
        },
        {
          kind: "school",
          title: "Georgia Institute of Technology",
          meta: [{ label: "Location", value: "Atlanta, GA" }],
        },
        {
          kind: "school",
          title: "California Institute of Technology",
          meta: [{ label: "Location", value: "Pasadena, CA" }],
        },
        {
          kind: "school",
          title: "Harvey Mudd College",
          meta: [{ label: "Location", value: "Claremont, CA" }],
        },
      ],
    },
    note: "Catalog",
  }),
  fixture({
    group: "Workspace reads",
    tool: "view_schools",
    label: "Checking the school list",
    detail: {
      summary: "6 schools · 2 deadlines approaching",
      result_count: 3,
      workspace_items: [
        {
          kind: "school",
          title: "Stanford University",
          meta: [
            { label: "Round", value: "regular_decision" },
            { label: "Deadline", value: "2026-12-15" },
            { label: "Tasks", value: "3/5" },
          ],
        },
        {
          kind: "school",
          title: "Georgia Tech",
          meta: [
            { label: "Round", value: "early_action" },
            { label: "Essays", value: "1/2" },
          ],
        },
        {
          kind: "school",
          title: "University of Michigan",
          meta: [{ label: "Round", value: "regular_decision" }],
        },
      ],
    },
    note: "Complete",
  }),
  fixture({
    group: "Workspace reads",
    tool: "get_school",
    label: "Looking inside Stanford University",
    detail: {
      summary: "5 tasks · 2 essays",
      result_count: 1,
      workspace_items: [
        {
          kind: "school",
          title: "Stanford University",
          meta: [
            { label: "Round", value: "regular_decision" },
            { label: "Deadline", value: "2026-12-15" },
            { label: "Tasks", value: "3/5" },
            { label: "Essays", value: "1/2" },
          ],
          status: "in_progress",
        },
      ],
    },
    note: "School detail",
  }),
  fixture({
    group: "Workspace reads",
    tool: "view_essays",
    label: "Checking the essay library",
    detail: {
      summary: "4 essays",
      result_count: 3,
      workspace_items: [
        {
          kind: "essay",
          title: "Stanford personal statement",
          meta: [
            { label: "School", value: "Stanford University" },
            { label: "Words", value: "612/650" },
          ],
          status: "Revising",
        },
        {
          kind: "essay",
          title: "Roommate letter",
          meta: [
            { label: "School", value: "Stanford University" },
            { label: "Words", value: "188/250" },
          ],
          status: "Drafting",
        },
        {
          kind: "essay",
          title: "Why Georgia Tech?",
          meta: [{ label: "Words", value: "241/300" }],
          status: "Not started",
        },
      ],
    },
    note: "Complete",
  }),
  fixture({
    group: "Workspace reads",
    tool: "read_essay",
    label: "Reading the Stanford personal statement",
    detail: {
      result_count: 1,
      workspace_items: [
        {
          kind: "essay",
          title: "Stanford personal statement",
          meta: [
            { label: "Type", value: "Personal statement" },
            { label: "Words", value: "612/650" },
            { label: "School", value: "Stanford University" },
          ],
          status: "Revising",
        },
      ],
    },
    note: "Essay detail",
  }),
  fixture({
    group: "Workspace reads",
    tool: "view_activities",
    label: "Checking activities and honors",
    detail: {
      summary: "7 activities · 3 honors",
      result_count: 5,
      workspace_items: [
        {
          kind: "activity",
          title: "Research assistant",
          meta: [{ label: "Organization", value: "Stanford AI Lab" }],
          group: "Activities",
        },
        {
          kind: "activity",
          title: "Debate captain",
          meta: [{ label: "Organization", value: "Lincoln High School" }],
          group: "Activities",
        },
        {
          kind: "activity",
          title: "Robotics team lead",
          meta: [{ label: "Organization", value: "FRC Team 254" }],
          group: "Activities",
        },
        {
          kind: "honor",
          title: "National Merit Semifinalist",
          meta: [],
          group: "Honors",
        },
        { kind: "honor", title: "ISEF Finalist", meta: [], group: "Honors" },
      ],
    },
    note: "Grouped",
  }),
  fixture({
    group: "Workspace reads",
    tool: "view_documents",
    label: "Checking your documents",
    detail: {
      summary: "3 documents",
      result_count: 3,
      workspace_items: [
        {
          kind: "document",
          title: "Activities résumé",
          meta: [
            { label: "Type", value: "resume" },
            { label: "Size", value: "182 KB" },
          ],
        },
        {
          kind: "document",
          title: "Unofficial transcript",
          meta: [
            { label: "Type", value: "transcript" },
            { label: "Size", value: "1.2 MB" },
          ],
        },
        {
          kind: "document",
          title: "Award certificates",
          meta: [{ label: "Type", value: "other" }],
        },
      ],
    },
    note: "Complete",
  }),
  fixture({
    group: "Workspace reads",
    tool: "read_document",
    label: "Reading the activities résumé",
    detail: {
      result_count: 1,
      workspace_items: [
        {
          kind: "document",
          title: "Activities résumé",
          meta: [
            { label: "Type", value: "resume" },
            { label: "File", value: "activities-resume.pdf" },
          ],
        },
      ],
    },
    note: "Document detail",
  }),
  fixture({
    group: "Workspace reads",
    tool: "view_tasks",
    label: "Checking the task list",
    status: "start",
    live: true,
    note: "Running",
  }),
  fixture({
    group: "Workspace reads",
    tool: "search_tasks",
    label: "Searching tasks for “scholarship appeal”",
    detail: {
      query: "scholarship appeal",
      summary: "No matching tasks",
      result_count: 0,
      workspace_items: [],
    },
    note: "Empty",
  }),
  fixture({
    group: "Workspace reads",
    tool: "view_documents",
    label: "Couldn’t check your documents",
    status: "error",
    detail: { error: "Documents are temporarily unavailable" },
    note: "Error",
  }),
];

const otherReadFixtures: readonly ToolCallFixture[] = [
  fixture({
    group: "Other reads",
    tool: "query_database",
    label: "Running a custom database query",
    tier: "official",
    detail: { row_count: 24, summary: "Compared current admissions metrics" },
    note: "Database",
  }),
  fixture({
    group: "Other reads",
    tool: "load_skill",
    label: "Consulting the “school-comparison” playbook",
    detail: { summary: "Loaded school-comparison guidance" },
    note: "Skill",
  }),
  fixture({
    group: "Other reads",
    tool: "render_viz",
    label: "Building an admissions comparison",
    detail: {
      viz_type: "comparison_table",
      schools: ["Yale University", "Stanford University"],
    },
    note: "Visualization receipt",
  }),
  fixture({
    group: "Other reads",
    tool: "read_tool_result",
    label: "Reading an oversized tool result",
    detail: { tool: "read_tool_result" },
    note: "Intentionally hidden",
  }),
  fixture({
    group: "Other reads",
    tool: "future_tool",
    label: "Working: future_tool",
    detail: { summary: "Unknown tools use the generic renderer" },
    note: "Fallback",
  }),
];

const writeTools = [
  ["create_tasks", "Adding two tasks to the plan"],
  ["update_task", "Updating a task"],
  ["archive_tasks", "Archiving one task"],
  ["restore_task", "Bringing back an archived task"],
  ["add_schools", "Adding Stanford University to the list"],
  ["update_school", "Updating a school"],
  ["archive_schools", "Removing one school from the list"],
  ["restore_school", "Bringing back a removed school"],
  ["create_essays", "Adding an essay to the library"],
  ["update_essay", "Updating an essay"],
  ["duplicate_essay", "Copying an essay"],
  ["archive_essays", "Archiving an essay"],
  ["restore_essay", "Bringing back an archived essay"],
  ["edit_essay", "Editing an essay"],
  ["write_essay", "Drafting an essay"],
  ["create_activities", "Adding two activities"],
  ["update_activity", "Updating an activity"],
  ["archive_activities", "Removing an activity"],
  ["restore_activity", "Bringing back an activity"],
  ["reorder_activities", "Reordering the activities list"],
  ["create_honors", "Adding an honor"],
  ["update_honor", "Updating an honor"],
  ["archive_honors", "Removing an honor"],
  ["restore_honor", "Bringing back an honor"],
  ["reorder_honors", "Reordering the honors list"],
  ["update_profile", "Updating your profile"],
  ["remember", "Remembering…"],
  ["update_memory", "Updating a memory"],
  ["forget", "Forgetting one memory"],
] as const;

const genericWriteFixtures = writeTools.map(([tool, label]) =>
  fixture({
    group: "Writes",
    tool,
    label,
    detail: { summary: "Change completed" },
    note: "Generic mutation",
  }),
);

const specializedWriteFixtures: readonly ToolCallFixture[] = [
  fixture({
    group: "Writes",
    tool: "create_tasks",
    label: "Adding Stanford interview prep to the plan",
    status: "start",
    live: true,
    note: "Task card · running",
    ui: {
      widget: "task_added",
      data: {
        title: "Prepare for Stanford interview",
        school: "Stanford University",
        due_date: "Nov 12",
        status: "planning",
      },
    },
  }),
  fixture({
    group: "Writes",
    tool: "create_tasks",
    label: "Adding Stanford interview prep to the plan",
    note: "Task card",
    ui: {
      widget: "task_added",
      data: {
        title: "Prepare for Stanford interview",
        school: "Stanford University",
        due_date: "Nov 12",
        status: "planned",
      },
    },
  }),
  fixture({
    group: "Writes",
    tool: "create_tasks",
    label: "Adding Stanford interview prep to the plan",
    status: "error",
    note: "Task card · error",
    ui: {
      widget: "task_added",
      data: {
        title: "Prepare for Stanford interview",
        school: "Stanford University",
        due_date: "Nov 12",
        status: "failed",
      },
    },
  }),
  fixture({
    group: "Writes",
    tool: "write_plan",
    label: "Updating the plan",
    plan: true,
    live: true,
    note: "Plan checklist",
    detail: {
      completed: 1,
      total: 3,
      items: [
        { content: "Resolve the schools", status: "completed" },
        { content: "Compare admissions data", status: "in_progress" },
        { content: "Summarize the differences", status: "pending" },
      ],
    },
  }),
];

export const TOOL_CALL_FIXTURES = Object.freeze([
  ...schoolDataFixtures,
  ...searchFixtures,
  ...workspaceReadFixtures,
  ...otherReadFixtures,
  ...specializedWriteFixtures,
  ...genericWriteFixtures,
]);

export const TOOL_CALL_GROUPS = Object.freeze([
  "School data",
  "Search",
  "Workspace reads",
  "Other reads",
  "Writes",
] as const);
