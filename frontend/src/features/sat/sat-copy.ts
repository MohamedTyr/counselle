/** Every user-facing string for SAT practice, in one place (plan §5.2;
 * ui-spec §8: sentence case, no exclamation marks, second person, "Try
 * again" never "Retry"). Nothing here is JSX — components read these
 * strings and template the dynamic parts themselves. */

/** The dashboard header's greeting (F1, O2, O9): 13 `{main, sub}` pairs,
 * re-voiced from liprep's in-joke originals into Counselle's own register.
 * One is picked once per mount and rendered as a single line, "{main} —
 * {sub}". */
export const SAT_GREETINGS: ReadonlyArray<{ readonly main: string; readonly sub: string }> = [
  { main: "Good morning", sub: "let's lock in" },
  { main: "Welcome back", sub: "pick up where you left off" },
  { main: "Ready when you are", sub: "one question at a time" },
  { main: "Let's build some momentum", sub: "consistency beats cramming" },
  { main: "Focus mode", sub: "distractions off, brain on" },
  { main: "Every rep counts", sub: "the curve doesn't know you're tired" },
  { main: "Back at it", sub: "the bank remembers your progress" },
  { main: "Small sets, real gains", sub: "twenty minutes still moves the needle" },
  { main: "Steady work wins", sub: "no shortcuts, just reps" },
  { main: "Today's a good day to practice", sub: "your future self will thank you" },
  { main: "Time to sharpen up", sub: "accuracy first, speed follows" },
  { main: "Keep the streak alive", sub: "or start a new one right now" },
  { main: "Let's find the gaps", sub: "practice is how you find them" },
];

export const SAT_DASHBOARD_COPY = {
  title: "SAT practice",
  analyticsAction: "Analytics",
  filterHeading: "Filter",
  excludeBluebookLabel: "Exclude Bluebook practice questions",
  difficultyHeading: "Difficulty (1–7)",
  difficultyTiers: {
    easy: "Easy (1–3)",
    medium: "Medium (4–5)",
    hard: "Hard (6–7)",
  },
  statusOptions: {
    all: "All",
    unsolved: "Unsolved",
    incorrect: "Mistakes",
    bookmarked: "Bookmarks",
  },
  startSession: "Start session",
  startDisabledNoSkill: "Select at least one skill",
  startDisabledNoBand: "Select at least one difficulty band",
  selectAll: "Select all",
  deselectAll: "Deselect all",
  activityHeading: "Activity",
  legendLess: "Less",
  legendMore: "More",
  noPracticeYet: "No practice yet",
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
  },
  studentProducedResponseLabel: "Student-produced response",
  sprPlaceholder: "e.g. 3/4 or 0.75",
  sprCorrect: "Correct",
  sprIncorrect: (accepted: readonly string[]) => `Incorrect. Accepted: ${accepted.join(", ")}`,
  explanation: "Explanation",
  previousAttempts: (count: number) => `Previous attempts (${count})`,
  solved: "Solved",
  notSolvedYet: "Not solved yet",
  questionCounter: (index: number, total: number) => `Question ${index} of ${total}`,
  checkAnswer: "Check answer",
  next: "Next",
  finishSession: "Finish session",
  navigator: {
    title: "Question bank",
    legend: {
      correct: "Correct",
      incorrect: "Incorrect",
      forReview: "For review",
      upsolved: "Upsolved",
    },
    caption: "✓ ✕ this session · Upsolved across all your attempts",
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
    description: (filterLabel: string, count: number) =>
      `${filterLabel} is the narrowest filter — ${count} questions match everything else.`,
    allZero: "Nothing matches even with one filter removed.",
    relax: (filterLabel: string) => `Relax ${filterLabel}`,
    backToFilters: "Back to filters",
  },
  unknownQuestion: {
    title: "Question not found",
    description: (questionId: string) => `Question ${questionId} is not in the question bank.`,
    backToPractice: "Back to SAT practice",
  },
  submitFailedToast: "Could not check your answer. Try again.",
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

export const SAT_ANALYTICS_COPY = {
  title: "Analytics and progress",
  tabs: {
    overview: "Overview",
    radar: "Radar web",
    pace: "Pace matrix",
    bands: "Score bands",
    domains: "All domains and skills",
  },
  overview: {
    firstTryAccuracy: "First-try accuracy",
    ebrw: "EBRW",
    math: "Math",
    upsolve: "Upsolve",
    correctedSuffix: (count: number) => `${count} corrected`,
    unsolvedMistakes: (count: number) => `${count} unsolved mistakes`,
    uniqueAttemptedLine: (count: number) => `${count} unique questions attempted`,
    avgAndTotalLine: (avgSeconds: number, totalTime: string) =>
      `~${avgSeconds}s average · ${totalTime} total`,
    sectionComparisonTable: {
      firstTryAccuracy: "First-try accuracy",
      overallAccuracy: "Overall accuracy",
      averagePace: "Average pace",
      upsolved: "Upsolved",
    },
    donut: {
      neverMissed: "Correct, never missed",
      upsolved: "Upsolved",
      unsolved: "Unsolved",
      attempted: "attempted",
    },
    skillsToReinforce: {
      heading: "Skills to reinforce",
      subtitle: "Your four lowest first-try accuracies, whatever the volume",
      attemptsAndPace: (attempts: number, avgSeconds: number) =>
        `${attempts} attempts · ~${avgSeconds}s`,
      practiceDrill: "Practice drill",
    },
  },
  radar: {
    domainSummary: "Domain summary",
    noData: "no data",
    questionsAndPace: (count: number, avgSeconds: number) => `${count} questions · ~${avgSeconds}s`,
  },
  bands: {
    sectionSegments: {
      all: "All sections",
      ebrw: "EBRW",
      math: "Math",
    },
    emptyBand: "—",
  },
  domains: {
    sectionSegments: (ebrw: number, math: number, all: number) => ({
      all: `All domains (${all})`,
      ebrw: `EBRW (${ebrw})`,
      math: `Math (${math})`,
    }),
    searchPlaceholder: "Search skills",
    domainSummaryLine: (attempted: number, firstTryPct: number, avgSeconds: number) =>
      `${attempted} attempted · ${firstTryPct} % first try · ~${avgSeconds}s`,
    practice: "Practice",
    noSkillsMatch: {
      title: "No skills match",
      description: (count: number) =>
        `Your search is the narrowest filter — ${count} skills match everything else.`,
      clearSearch: "Clear search",
    },
  },
  loadFailed: {
    title: "Could not load your progress",
    description: "The workspace could not reach your practice history.",
    retry: "Try again",
  },
  empty: {
    title: "No practice yet",
    description: "Answer a few questions and your progress appears here.",
    action: "Start practising",
  },
  footer: {
    summary: (attempts: number, avgSeconds: number) =>
      `${attempts} attempts · ~${avgSeconds}s average pace`,
    dataAndProgress: "Data and progress",
    exportProgress: "Export progress",
    exportingToast: (fileName: string) => `Exporting ${fileName}…`,
    importProgress: "Import progress",
    importedToast: (attempts: number, bookmarks: number) =>
      `Imported ${attempts} attempts and ${bookmarks} bookmarks.`,
    importErrors: {
      notAnExport: "That file is not a progress export.",
      tooLarge: "That file is too large to import.",
      generic: "Could not import that file. Try again.",
    },
    importConfirm: {
      title: "Replace your SAT progress?",
      description: (attempts: number, bookmarks: number, fileName: string) =>
        `This replaces ${attempts} attempts and ${bookmarks} bookmarks with the contents of ${fileName}. Export first if you want a copy.`,
      cancel: "Cancel",
      confirm: "Replace progress",
    },
  },
  reset: {
    pressSequence: ["Reset progress", "Press again to continue", "One more press"] as const,
    confirm: {
      title: "Reset all SAT progress?",
      description: (attempts: number, bookmarks: number) =>
        `This deletes ${attempts} attempts and ${bookmarks} bookmarks. Your saved filters stay. Export first if you want a copy.`,
      cancel: "Cancel",
      confirm: "Reset progress",
    },
  },
} as const;
