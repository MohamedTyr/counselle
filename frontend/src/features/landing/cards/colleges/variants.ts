import type { ComponentType } from "react";
import type { FeatureSize } from "../../sections/featureList";
import type { Sequence } from "../../useIllustrationMotion";
import { CollegesSheet } from "../CollegesCard";
import { ColumnsSheet } from "./ColumnsSheet";
import { WhySheet } from "./WhySheet";
import { MapSheet } from "./MapSheet";
import { AskSheet } from "./AskSheet";
import { playAsk, playColumns, playMap, playWhy } from "./demos";

export type CollegesVariant = {
  id: string;
  label: string;
  /** What the illustration is trying to say, for the comparison page. */
  idea: string;
  size: FeatureSize;
  Sheet: ComponentType;
  /** The stage's own sequence plays when this is absent. */
  play?: (seq: Sequence) => void;
};

/**
 * Candidate illustrations for "Colleges that match you". `?colleges=<id>`
 * puts one on the stage; `?colleges=compare` lays them all out on the page.
 */
export const COLLEGES_VARIANTS: CollegesVariant[] = [
  {
    id: "current",
    label: "Current",
    idea: "The shipped list with its popover, for reference.",
    size: "third",
    Sheet: CollegesSheet,
  },
  {
    id: "columns",
    label: "Sorted into columns",
    idea: "Your profile on top; each school is dealt from it into Reach, Target or Safety.",
    size: "wide",
    Sheet: ColumnsSheet,
    play: playColumns,
  },
  {
    id: "why",
    label: "Why it fits",
    idea: "The selection glides to one school and a docked panel explains the fit against your grades, budget and major.",
    size: "wide",
    Sheet: WhySheet,
    play: playWhy,
  },
  {
    id: "map",
    label: "Fit map",
    idea: "Every school checked lands as a dot; the five that fit drop in, placed by chances and fit.",
    size: "wide",
    Sheet: MapSheet,
    play: playMap,
  },
  {
    id: "ask",
    label: "Ask for a list",
    idea: "The agent checks 400+ schools, answers in a sentence, and saves the sorted list to your schools.",
    size: "wide",
    Sheet: AskSheet,
    play: playAsk,
  },
];

export const COLLEGES_PARAM = new URLSearchParams(window.location.search).get(
  "colleges",
);

/** The illustration the landing page ships with. */
const DEFAULT_VARIANT_ID = "ask";

export const COLLEGES_VARIANT =
  COLLEGES_VARIANTS.find((variant) => variant.id === COLLEGES_PARAM) ??
  COLLEGES_VARIANTS.find((variant) => variant.id === DEFAULT_VARIANT_ID)!;
