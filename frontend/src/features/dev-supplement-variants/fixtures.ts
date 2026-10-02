import type {
  ApplicationSupplements,
  EssaySummary,
  SupplementPrompt,
} from "@/api/workspace/types";
import { essayFromSummary, type Essay } from "@/domain/essay";

/* Real 2026-27 prompts (counselle.supplement_prompts) for the variant gallery,
 * one school per state a surface must handle. */

function prompt(
  key: string,
  text: string,
  extra: Partial<SupplementPrompt> = {},
): SupplementPrompt {
  return {
    key,
    prompt: text,
    context: null,
    word_limit: null,
    requirement: "required",
    group_label: null,
    choose_count: null,
    applies_to: null,
    essay_id: null,
    ...extra,
  };
}

function supplements(
  applicationId: string,
  unitid: number,
  status: ApplicationSupplements["status"],
  prompts: SupplementPrompt[],
  checked: ApplicationSupplements["checked"] = "unchecked",
): ApplicationSupplements {
  return {
    application_id: applicationId,
    school_unitid: unitid,
    cycle: "2026-2027",
    status,
    checked,
    checked_on: checked === "unchecked" ? null : "2026-10-01",
    changed_at: "2026-10-01T22:30:00Z",
    prompts,
  };
}

const YALE_GROUP = "respond to one of the following prompts in 400 words or fewer.";
const DUKE_GROUP =
  "We want to emphasize that the following questions are optional. We invite you to answer one of the three if you believe that doing so will add something meaningful that is not already addressed elsewhere in your application.";

export const yaleSupplements = supplements("app-yale", 130794, "prompts", [
  prompt("yale-1", "Tell us about a topic or idea that excites you and is related to one or more academic areas you selected above. Why are you drawn to it?", { word_limit: 200, essay_id: "essay-yale-1" }),
  prompt("yale-2", "If you could teach any college course, write a book, or create an original piece of art of any kind, what would it be?", { essay_id: "essay-yale-2" }),
  prompt("yale-5", "Reflect on a time you discussed an issue important to you with someone holding an opposing view. Why did you find the experience meaningful?", { word_limit: 400, group_label: YALE_GROUP, choose_count: 1 }),
  prompt("yale-6", "Reflect on your membership in a community to which you feel connected. Why is this community meaningful to you? You may define community however you like.", { word_limit: 400, group_label: YALE_GROUP, choose_count: 1 }),
  prompt("yale-7", "Reflect on an element of your personal experience that you feel will enrich your college. How has it shaped you?", { word_limit: 400, group_label: YALE_GROUP, choose_count: 1 }),
]);

/* The same Yale set after the student picked the second option. */
export const yalePickedSupplements: ApplicationSupplements = {
  ...yaleSupplements,
  prompts: yaleSupplements.prompts.map((p) =>
    p.key === "yale-6" ? { ...p, essay_id: "essay-yale-6" } : p,
  ),
};

export const dukeSupplements = supplements("app-duke", 198419, "prompts", [
  prompt("duke-1", "What is your impression of Duke as a university and community, and why do you believe it is a good match for your goals, values, and interests? If there is something specific that attracts you to our academic offerings in Trinity College of Arts and Sciences or the Pratt School of Engineering, or to our co-curricular opportunities, feel free to include that, too.", { word_limit: 250, essay_id: "essay-duke-1" }),
  prompt("duke-2", "We all belong to communities defined by place, faith, family, culture, interests or shared experience. Tell us about a community that has shaped who you are, any way it has set you apart, and what you’ve learned from being part of it that you hope to bring to Duke.", { word_limit: 250, essay_id: "essay-duke-2" }),
  prompt("duke-3", "We believe a wide range of viewpoints and experiences is essential to maintaining Duke’s vibrant community. If you’d like to share a perspective you bring or experiences you’ve had to help us understand you better, perhaps related to a community you belong to or your family or cultural background, we encourage you to do so here.", { word_limit: 250, requirement: "optional", group_label: DUKE_GROUP, choose_count: 1 }),
  prompt("duke-4", "Meaningful dialogue often involves respectful disagreement. Provide an example of a difference of opinion you’ve had with someone you care about. What did you learn from it?", { word_limit: 250, requirement: "optional", group_label: DUKE_GROUP, choose_count: 1 }),
  prompt("duke-5", "What’s the last thing that you’ve been really excited about?", { word_limit: 250, requirement: "optional", group_label: DUKE_GROUP, choose_count: 1 }),
]);

export const cornellSupplements = supplements("app-cornell", 190415, "prompts", [
  prompt("cornell-4", "At the College of Arts and Sciences, curiosity will be your guide. Discuss how your passion for learning is shaping your academic journey, and what areas of study or majors excite you and why.", { word_limit: 650, applies_to: "College of Arts & Sciences applicants" }),
  prompt("cornell-7", "Fundamentally, engineering is the application of math, science, and technology to solve complex problems. Why do you want to study engineering?", { word_limit: 200, applies_to: "College of Engineering applicants" }),
  prompt("cornell-9", "What brings you joy?", { word_limit: 100, applies_to: "College of Engineering applicants" }),
  prompt("cornell-x", "Is there anything else you would like us to know about you?", { word_limit: 250, requirement: "optional" }),
], "official_site");

export const gatechSupplements = supplements("app-gatech", 139755, "none", [], "official_site");
export const ohioStateSupplements = supplements("app-osu", 204796, "unlisted", [], null);

function summary(
  id: string,
  applicationId: string,
  schoolName: string,
  title: string,
  promptText: string,
  extra: Partial<EssaySummary> = {},
): EssaySummary {
  return {
    id,
    user_id: "demo",
    application_id: applicationId,
    title,
    essay_type: "Supplement",
    status: "Not started",
    prompt: promptText,
    preview: "",
    word_count: 0,
    word_limit: null,
    comment_count: 0,
    suggestion_count: 0,
    archived_via_application: null,
    school_name: schoolName,
    school_city: null,
    school_state: null,
    school_website_url: null,
    deadline: "2027-01-02",
    created_at: "2026-10-01T22:30:00Z",
    updated_at: "2026-10-01T22:30:00Z",
    archived_at: null,
    supplement_key: null,
    prompt_previous: null,
    prompt_updated_at: null,
    prompt_removed_at: null,
    ...extra,
  };
}

export const yaleEssaySummaries: EssaySummary[] = [
  summary("essay-yale-1", "app-yale", "Yale University", "Tell us about a topic or idea that excites you…", yaleSupplements.prompts[0].prompt, { word_limit: 200, word_count: 140, status: "Drafting", supplement_key: "yale-1" }),
  summary("essay-yale-2", "app-yale", "Yale University", "If you could teach any college course, write a book…", yaleSupplements.prompts[1].prompt, { supplement_key: "yale-2" }),
];

export const yalePickedEssaySummary = summary("essay-yale-6", "app-yale", "Yale University", "Reflect on your membership in a community…", yaleSupplements.prompts[3].prompt, { word_limit: 400, supplement_key: "yale-6" });

/* Duke's first essay carries an unreviewed prompt change from the school. */
export const dukeEssaySummaries: EssaySummary[] = [
  summary("essay-duke-1", "app-duke", "Duke University", "What is your impression of Duke as a university and community…", dukeSupplements.prompts[0].prompt, {
    word_limit: 250,
    word_count: 212,
    status: "Drafting",
    supplement_key: "duke-1",
    prompt_previous: "What is your impression of Duke as a university, and why do you believe it is a good match for you?",
    prompt_updated_at: "2026-10-02T06:00:00Z",
  }),
  summary("essay-duke-2", "app-duke", "Duke University", "Tell us about a community that has shaped who you are…", dukeSupplements.prompts[1].prompt, { word_limit: 250, supplement_key: "duke-2" }),
];

export const toEssays = (rows: EssaySummary[]): Essay[] => rows.map(essayFromSummary);
