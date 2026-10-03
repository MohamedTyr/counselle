import {
  Award,
  BookOpen,
  GraduationCap,
  Landmark,
  Lightbulb,
  Medal,
  Star,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/*
 * The stand-in for a sponsor with no logo: one of a few scholarship icons on
 * one of the nav's tile/stroke colour pairs (app-shell/navigation.tsx and its
 * icons), picked from the sponsor's name so a sponsor always gets the same
 * mark and a page of logo-less cards does not repeat one icon.
 */

const ICONS: readonly LucideIcon[] = [
  GraduationCap,
  Award,
  BookOpen,
  Trophy,
  Medal,
  Lightbulb,
  Star,
  Landmark,
];

const TONES = [
  { tile: "#e9f8ef", ink: "#0a6b3d" },
  { tile: "#fdedf4", ink: "#b4366e" },
  { tile: "#fdf0de", ink: "#c2680a" },
  { tile: "#eee9fe", ink: "#6d40dc" },
  { tile: "#e5f0fe", ink: "#1d6ed2" },
  { tile: "#fdecea", ink: "#d22d26" },
  { tile: "#def7f3", ink: "#0d8c82" },
] as const;

export type SponsorMark = { Icon: LucideIcon; tile: string; ink: string };

function hash(text: string): number {
  let value = 5381;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 33 + text.charCodeAt(index)) >>> 0;
  }
  return value;
}

export function sponsorMark(name: string): SponsorMark {
  const value = hash(name.trim().toLowerCase());
  const tone = TONES[Math.floor(value / ICONS.length) % TONES.length];
  return { Icon: ICONS[value % ICONS.length], ...tone };
}
