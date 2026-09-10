// "Plan with Counselle" (plans/tasks-redesign-plan.md P7.2, spec §8.1,
// decision D2). There is no hidden context channel — the current view, the
// visible tasks, and today's date are folded into the one visible, editable
// `draftPrompt` string the composer already supports
// (`features/ai-composer/draft-prompt.ts`). Capped at 40 tasks and at
// `MAX_PROMPT_LENGTH` characters, matching `parseDraftPromptState`'s own cap
// exactly — a longer string would just be silently dropped by the composer.
import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import type { Task } from "@/domain/task";
import { getDerivedLabel } from "@/features/tasks/task-config";
import { formatDeadline, formatWhenChip } from "@/features/tasks/task-dates";

const MAX_TASKS = 40;
/** Matches `MAX_DRAFT_PROMPT_LENGTH` in `features/ai-composer/draft-prompt.ts`. */
const MAX_PROMPT_LENGTH = 2000;

/** "Friday, 4 September 2026" — spec §8.1's `<weekday, D Month YYYY>`. */
function formatLongDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  return `${weekday}, ${day} ${month} ${date.getFullYear()}`;
}

function formatTaskLine(
  task: Task,
  applicationsById: ReadonlyMap<string, ApplicationView>,
  essaysById: ReadonlyMap<string, EssaySummary>,
): string {
  const when = task.when_on ? formatWhenChip(task.when_on) : "no date";
  const deadline = task.deadline_on ? formatDeadline(task.deadline_on) : "none";
  const label = getDerivedLabel(task, applicationsById, essaysById);
  return `- ${task.title} — when: ${when}, deadline: ${deadline}${label ? `, ${label}` : ""}`;
}

/**
 * Builds the visible, editable draft prompt handed to `<Link state=
 * {{ draftPrompt }} to="/app/ai" />` — the same handoff
 * `SchoolDetailRoute.tsx` and `SchoolFactsPanel.tsx` already use. Task lines
 * are added until either the 40-task cap or the character cap is hit,
 * whichever comes first; a task dropped for length is simply not listed
 * (never silently truncated mid-line).
 */
export function buildTasksDraftPrompt({
  applicationsById,
  defaultQuestion,
  essaysById,
  referenceDate,
  tasks,
  viewName,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  defaultQuestion: string;
  essaysById: ReadonlyMap<string, EssaySummary>;
  referenceDate: Date;
  tasks: Task[];
  viewName: string;
}): string {
  const header = `${defaultQuestion}\n\nToday is ${formatLongDate(referenceDate)}. Here is what I have in ${viewName}:`;

  let body = header;
  for (const task of tasks.slice(0, MAX_TASKS)) {
    const line = formatTaskLine(task, applicationsById, essaysById);
    const candidate = `${body}\n${line}`;
    if (candidate.length > MAX_PROMPT_LENGTH) {
      break;
    }
    body = candidate;
  }
  return body;
}
