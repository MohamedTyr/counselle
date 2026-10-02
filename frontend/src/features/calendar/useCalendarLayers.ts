// Which calendars are shown is a per-device view preference, not data, so it
// lives in localStorage. Storage can throw (a private window, blocked site
// data) or hold something stale, so every read falls back to the defaults.
import { useState } from "react";

import type { CalendarRound } from "@/api/calendar/types";
import {
  CALENDAR_ROUND_ORDER,
  DEFAULT_LAYERS,
  type CalendarLayers,
} from "@/features/calendar/calendar-items";

const LAYERS_STORAGE_KEY = "counselle:calendar:layers";

function readLayers(): CalendarLayers {
  try {
    const raw = window.localStorage.getItem(LAYERS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_LAYERS;
    }
    const stored = JSON.parse(raw) as Partial<CalendarLayers>;
    const rounds = Array.isArray(stored.allSchoolsRounds)
      ? CALENDAR_ROUND_ORDER.filter((round) =>
          stored.allSchoolsRounds?.includes(round),
        )
      : DEFAULT_LAYERS.allSchoolsRounds;
    const flag = (key: keyof Omit<CalendarLayers, "allSchoolsRounds">) =>
      typeof stored[key] === "boolean" ? stored[key] : DEFAULT_LAYERS[key];
    return {
      allSchools: flag("allSchools"),
      allSchoolsRounds: rounds,
      due: flag("due"),
      mySchools: flag("mySchools"),
      showCompleted: flag("showCompleted"),
      tasks: flag("tasks"),
    };
  } catch {
    return DEFAULT_LAYERS;
  }
}

function writeLayers(layers: CalendarLayers) {
  try {
    window.localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(layers));
  } catch {
    // A preference that cannot be saved still applies for this visit.
  }
}

export type LayerFlag = keyof Omit<CalendarLayers, "allSchoolsRounds">;

export function useCalendarLayers() {
  const [layers, setLayers] = useState<CalendarLayers>(readLayers);

  function commit(next: CalendarLayers) {
    setLayers(next);
    writeLayers(next);
  }

  function setFlag(flag: LayerFlag, value: boolean) {
    commit({ ...layers, [flag]: value });
  }

  function toggleRound(round: CalendarRound) {
    const rounds = layers.allSchoolsRounds.includes(round)
      ? layers.allSchoolsRounds.filter((item) => item !== round)
      : CALENDAR_ROUND_ORDER.filter(
          (item) => item === round || layers.allSchoolsRounds.includes(item),
        );
    commit({ ...layers, allSchoolsRounds: rounds });
  }

  return { layers, setFlag, toggleRound };
}
