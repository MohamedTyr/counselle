/** Copy for the SAT analytics dialog. Counts are pluralised and durations
 * formatted by the helpers in `sat-analytics.ts`; strings here only compose. */
import { formatDuration, plural } from "@/features/sat/sat-analytics";

export const SAT_ANALYTICS_COPY = {
  title: "Analytics and progress",
  tabs: {
    overview: "Overview",
    radar: "Radar web",
    pace: "Pace matrix",
    bands: "Score bands",
    domains: "Skills",
  },
  sections: {
    label: "Section",
    ebrw: "Reading & Writing",
    math: "Math",
  },
  overview: {
    headline: "First try",
    sectionsHeading: "By section",
    standingHeading: "Where your questions stand",
    standing: {
      neverMissed: "Right every time",
      upsolved: "Missed, then got right",
      unsolved: "Wrong on latest attempt",
    },
    stats: {
      heading: "All attempts",
      overallAccuracy: "Accuracy",
      averagePace: "Average per attempt",
      timePracticed: "Time practiced",
    },
    skillsToReinforce: {
      heading: "Skills to reinforce",
      measure: "first try",
      practiceDrill: "Practice",
    },
  },
  radar: {
    chartHeading: "Accuracy by domain",
    domainSummary: "By domain",
    noData: "No data yet",
    legendFirstTry: "First try",
    legendOverall: "All attempts",
    tooltip: {
      firstTry: (value: string) => `First try: ${value}`,
      overall: (value: string) => `All attempts: ${value}`,
    },
  },
  pace: {
    quadrants: {
      fastAccurate: "Fast and accurate",
      accurateSlow: "Accurate but slow",
      fastInaccurate: "Fast but inaccurate",
      slowInaccurate: "Slow and inaccurate",
    },
    axisSeconds: "Seconds per attempt",
    axisAccuracy: "Accuracy · first try",
    targetLine: (seconds: number) => `SAT pace · ${seconds}s`,
    targetOffscreen: (seconds: number) => `SAT pace ${seconds}s →`,
    legendReading: "Reading & Writing",
    legendMath: "Math",
    pointMeta: (accuracyPct: number, avgSeconds: number, attempts: number) =>
      `${accuracyPct}% first try · ${formatDuration(avgSeconds)} · ${plural(attempts, "attempt")}`,
  },
  bands: {
    sectionSegments: {
      all: "All sections",
      ebrw: "Reading & Writing",
      math: "Math",
    },
    heading: "Band",
    accuracyRow: "Accuracy · all attempts",
    bandDirection: "easier → harder",
    paceRow: "Pace",
    attemptsRow: "Attempts",
    emptyBand: "—",
  },
  domains: {
    sectionSegments: (ebrw: number, math: number, all: number) => ({
      all: `All (${all})`,
      ebrw: `Reading & Writing (${ebrw})`,
      math: `Math (${math})`,
    }),
    searchPlaceholder: "Search skills",
    columns: {
      skill: "Skill",
      firstTry: "First try",
      overall: "All attempts",
      questions: "Questions",
      pace: "Pace",
    },
    questionsCell: (unique: number, attempts: number) =>
      attempts === unique ? `${unique}` : `${unique} (${plural(attempts, "attempt")})`,
    practice: "Practice",
    noSkillsMatch: {
      title: "No skills match",
      description: (count: number) =>
        `Your search is the narrowest filter — ${plural(count, "skill")} match everything else.`,
      clearSearch: "Clear search",
    },
  },
  loadFailed: {
    title: "Could not load your progress",
    description: "The workspace could not reach your practice history.",
    retry: "Try again",
  },
  empty: {
    title: "Your analytics start with question one",
    description:
      "Answer a few questions and this fills in with your accuracy, pace and the skills worth another look.",
    action: "Start practicing",
  },
  footer: {
    dataAndProgress: "Data and progress",
    exportProgress: "Export progress",
    exportingToast: (fileName: string) => `Exporting ${fileName}…`,
    importProgress: "Import progress",
    importedToast: (attempts: number, bookmarks: number) =>
      `Imported ${plural(attempts, "attempt")} and ${plural(bookmarks, "bookmark")}.`,
    importErrors: {
      notAnExport: "That file is not a progress export.",
      tooLarge: "That file is too large to import.",
      generic: "Could not import that file. Try again.",
    },
    importConfirm: {
      title: "Replace your SAT progress?",
      description: (attempts: number, bookmarks: number, fileName: string) =>
        `This replaces ${plural(attempts, "attempt")} and ${plural(bookmarks, "bookmark")} with the contents of ${fileName}. Export first if you want a copy.`,
      cancel: "Cancel",
      confirm: "Replace progress",
    },
  },
  reset: {
    pressSequence: ["Reset progress", "Press again to continue", "One more press"] as const,
    confirm: {
      title: "Reset all SAT progress?",
      description: (attempts: number, bookmarks: number) =>
        `This deletes ${plural(attempts, "attempt")} and ${plural(bookmarks, "bookmark")}. Your saved filters stay. Export first if you want a copy.`,
      cancel: "Cancel",
      confirm: "Reset progress",
    },
  },
} as const;
