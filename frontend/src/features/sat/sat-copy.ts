/** Every user-facing string for SAT practice, in one place (plan §5.2;
 * ui-spec §8: sentence case, no exclamation marks, second person, "Try
 * again" never "Retry"). Nothing here is JSX — components read these
 * strings and template the dynamic parts themselves. */

export const SAT_DASHBOARD_COPY = {
  title: "SAT practice",
  analyticsAction: "Analytics",
  statusLabel: "Show questions",
  excludeBluebookLabel: "Exclude Bluebook practice questions",
  sessionHeading: "Session",
  difficultyHeading: "Difficulty",
  difficultyTiers: {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
  },
  statusOptions: {
    all: "All",
    unsolved: "Unsolved",
    incorrect: "Mistakes",
    bookmarked: "Bookmarks",
  },
  startSession: "Start session",
  startDisabledNoSkill: "Select at least one skill",
  startDisabledNoBand: "Select at least one difficulty",
  startDisabledNoMatch: "No questions match these filters",
  selectAll: "Select all",
  deselectAll: "Deselect all",
  activityHeading: "Activity",
  legendLess: "Less",
  legendMore: "More",
  noPracticeYet: "No practice yet. Your days fill in as you solve questions.",
  activityError: {
    title: "Could not load your activity",
    description: "The workspace could not reach your practice history.",
    retry: "Try again",
  },
  countsError: {
    title: "Could not load question counts",
    description: "The workspace could not reach your question counts.",
    retry: "Try again",
  },
  bankNotLoaded: {
    title: "Question bank not loaded",
    description: "The question bank has not been loaded on this server.",
  },
} as const;

/** "1 question" / "1,234 questions". */
export function pluralQuestions(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "question" : "questions"}`;
}

export function pluralSkills(count: number): string {
  return `${count} ${count === 1 ? "skill" : "skills"}`;
}

export const SAT_PRACTICE_COPY = {
  sectionLabel: {
    reading: "Section 1: Reading and Writing",
    math: "Section 2: Math",
  },
  timerToggleTooltip: "Toggle timer visibility",
  timerHiddenLabel: "Show",
  pauseTimer: "Pause timer",
  resumeTimer: "Resume timer",
  markForReview: "Mark for review",
  eliminateModeTooltip: "Toggle option elimination",
  eliminateChoice: (letter: string) => `Eliminate choice ${letter}`,
  restoreChoice: (letter: string) => `Restore choice ${letter}`,
  tools: {
    highlight: "Highlight",
    calculator: "Calculator",
    reference: "Reference",
    info: "Info",
    exit: "Exit",
    exitTooltip: "Exit to SAT practice",
  },
  highlightUnsupportedTooltip: "Highlighting isn't supported in this browser.",
  answerChoices: {
    correctAnswer: "Correct answer",
    yourAnswer: "Your answer",
    yourAnswerCorrect: "Your answer · Correct",
    groupLabel: "Answer choices",
  },
  verdict: {
    correct: "Correct",
    incorrect: (accepted: readonly string[]) =>
      `Not quite — the answer is ${accepted.join(" or ")}`,
  },
  questionNumber: (n: number) => `Question ${n}`,
  studentProducedResponseLabel: "Student-produced response",
  sprPlaceholder: "e.g. 3/4 or 0.75",
  explanation: "Explanation",
  previousAttempts: (count: number) => `Previous attempts (${count})`,
  solved: "Solved",
  notSolvedYet: "Not solved yet",
  questionCounter: (index: number, total: number) =>
    `Question ${index.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
  previous: "Previous",
  checkAnswer: "Check answer",
  next: "Next",
  finishSession: "Finish session",
  navigator: {
    title: "Question bank",
    legend: {
      correct: "Correct",
      incorrect: "Incorrect",
      forReview: "For review",
      upsolved: "Missed, then got right",
      current: "Current",
      difficulty: "Difficulty",
      difficultyHint: "One dot for easy, three for hard",
    },
    range: (from: number, to: number, total: number) =>
      `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
    previousPage: "Previous page",
    nextPage: "Next page",
    jumpLabel: "Go to question",
    jumpPlaceholder: "Number",
    jumpInvalid: (total: number) => `Enter a number from 1 to ${total.toLocaleString("en-US")}`,
  },
  sessionLoadFailed: {
    title: "Could not load this session",
    description: "The workspace could not reach your question list.",
    retry: "Try again",
  },
  bodyLoadFailed: {
    title: "Could not load this question",
    description: (index: number) => `The workspace could not reach question ${index}.`,
    retry: "Try again",
  },
  filteredToZero: {
    title: "No questions match",
    allZero: "Nothing matches even with one filter removed.",
    backToFilters: "Back to filters",
  },
  unknownQuestion: {
    title: "Question not found",
    description: "This question is not in the question bank.",
    backToPractice: "Back to SAT practice",
  },
  notAvailable: "not available",
} as const;

export const SAT_INFO_DIALOG_COPY = {
  fields: {
    questionId: "Question ID",
    searchTutorial: "Search for a tutorial",
    section: "Section",
    domain: "Domain",
    skill: "Skill",
    scoreBand: "Score band",
    difficulty: "Difficulty",
    itemType: "Item type",
    created: "Created",
    updated: "Updated",
  },
  reportIssue: "Report an issue",
} as const;
