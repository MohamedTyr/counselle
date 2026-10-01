import type { ComponentType } from "react";
import { MENTOR_CALLS } from "../brand";
import { EssaySheet } from "../cards/EssayCard";
import { AskSheet } from "../cards/AskSheet";
import { ScholarshipsSheet } from "../cards/ScholarshipsCard";
import { ActivitiesSheet } from "../cards/ActivitiesCard";
import { SatSheet } from "../cards/SatCard";
import { DeadlinesSheet } from "../cards/DeadlinesCard";
import { SessionsSheet } from "../cards/SessionsCard";

export type FeatureSize = "wide" | "third";

export type Feature = {
  id: string;
  title: string;
  blurb: string;
  size: FeatureSize;
  /** The saturated colour the current design paints this feature's card in. */
  color: string;
  /** A low-chroma tint of the same hue for light surfaces. */
  tint: string;
  /** A bright pastel of the same hue, for the glows in the stage's wash. */
  glow: string;
  /** How long the showcase stays here when it cannot time the demonstration itself. */
  dwell?: number;
  Sheet: ComponentType;
};

/** The features the showcase illustrates, in reading order. */
export const FEATURES: Feature[] = [
  {
    id: "sessions",
    title: "A real mentor, twice a month",
    blurb: `${MENTOR_CALLS} with someone who got in recently. Ask what you would ask a friend who has been through it.`,
    size: "wide",
    color: "#0f4a52",
    tint: "#e2f3f5",
    glow: "#8fdde6",
    Sheet: SessionsSheet,
  },
  {
    id: "essay",
    title: "Line-by-line comments in minutes",
    blurb:
      "Paste a draft and get comments on structure, clichés, weak verbs and the parts an admissions reader will skim. You accept or reject each note. It never rewrites your story for you.",
    size: "wide",
    color: "#121214",
    tint: "#ededf0",
    glow: "#b7bbcc",
    dwell: 6000,
    Sheet: EssaySheet,
  },
  {
    id: "colleges",
    title: "A list built on facts",
    blurb:
      "Reach, target and safety schools matched to your grades, scores, budget and what you want to study. Every admit rate and cost is cited.",
    size: "wide",
    color: "#3d3183",
    tint: "#ecebf8",
    glow: "#aba2ff",
    Sheet: AskSheet,
  },
  {
    id: "scholarships",
    title: "Money you actually qualify for",
    blurb:
      "Ranked by fit and deadline, with the requirements spelled out. No 2,000-item lists of awards you can’t apply to.",
    size: "third",
    color: "#6b2233",
    tint: "#f7e9ed",
    glow: "#ff9db2",
    dwell: 5000,
    Sheet: ScholarshipsSheet,
  },
  {
    id: "activities",
    title: "Programs that fit what you already do",
    blurb:
      "Research, competitions and summer programs. If you count birds at 5am, it finds the ecology programs. Filtered by grade, cost and deadline, with the free ones marked.",
    size: "third",
    color: "#7a4213",
    tint: "#f5ede4",
    glow: "#ffba7a",
    dwell: 5000,
    Sheet: ActivitiesSheet,
  },
  {
    id: "sat",
    title: "Official SAT questions, until your mistakes run out",
    blurb:
      "Practice with real College Board questions. Acceptra tracks what you miss and serves it back until you don’t.",
    size: "wide",
    color: "#16336b",
    tint: "#e8eef8",
    glow: "#9dbcff",
    dwell: 6000,
    Sheet: SatSheet,
  },
  {
    id: "deadlines",
    title: "Every school’s dates, one calendar",
    blurb:
      "ED, EA, regular, financial aid, scholarship and portfolio deadlines for every school on your list, with reminders before each one.",
    size: "wide",
    color: "#0f4d32",
    tint: "#e6f4ec",
    glow: "#93d99c",
    Sheet: DeadlinesSheet,
  },
];

/** The id of a feature's tab, which its panel is labelled by. */
export const stageTabId = (feature: Feature) => `lp-stage-tab-${feature.id}`;
