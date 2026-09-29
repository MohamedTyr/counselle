import type { ComponentType } from "react";
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
    blurb:
      "Two 20-minute calls a month with someone who got in recently. Ask what you would ask a friend who has been through it.",
    size: "wide",
    color: "#0f4a52",
    tint: "#e2f3f5",
    glow: "#8fdde6",
    Sheet: SessionsSheet,
  },
  {
    id: "essay",
    title: "Essay feedback, line by line",
    blurb:
      "It reads what you wrote and marks it up like an editor would. Every note is a suggestion you accept or reject.",
    size: "wide",
    color: "#121214",
    tint: "#ededf0",
    glow: "#b7bbcc",
    dwell: 6000,
    Sheet: EssaySheet,
  },
  {
    id: "colleges",
    title: "Colleges that match you",
    blurb:
      "A list built from your grades, budget and goals, with reach, target and safety already sorted.",
    size: "wide",
    color: "#3d3183",
    tint: "#ecebf8",
    glow: "#aba2ff",
    Sheet: AskSheet,
  },
  {
    id: "scholarships",
    title: "Scholarships you match",
    blurb: "Every award you qualify for, with the ones worth your time on top.",
    size: "third",
    color: "#6b2233",
    tint: "#f7e9ed",
    glow: "#ff9db2",
    dwell: 5000,
    Sheet: ScholarshipsSheet,
  },
  {
    id: "activities",
    title: "Activities that fit you",
    blurb:
      "Research, competitions and summer programs that fit what you are already into.",
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
      "Real questions, one at a time. Get one wrong and it explains the step you skipped, then serves more of that kind.",
    size: "wide",
    color: "#16336b",
    tint: "#e8eef8",
    glow: "#9dbcff",
    dwell: 6000,
    Sheet: SatSheet,
  },
  {
    id: "deadlines",
    title: "Tasks and deadlines, all in one place",
    blurb:
      "Every school’s dates pulled in for you, next to the work you planned for the week.",
    size: "wide",
    color: "#0f4d32",
    tint: "#e6f4ec",
    glow: "#93d99c",
    Sheet: DeadlinesSheet,
  },
];

/** The id of a feature's tab, which its panel is labelled by. */
export const stageTabId = (feature: Feature) => `lp-stage-tab-${feature.id}`;
