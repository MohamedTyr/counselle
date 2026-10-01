import type { Dispatch, SetStateAction } from "react";

import type { Activity, Honor } from "@/domain/activity";

export type ActivitiesPageProps = {
  activities?: Activity[];
  onActivitiesChange?: Dispatch<SetStateAction<Activity[]>>;
  honors?: Honor[];
  onHonorsChange?: Dispatch<SetStateAction<Honor[]>>;
};

export type ActivitiesTab = "activities" | "honors";

/** One Common App slot: paste-ready, still to finish, or over a limit. */
export type SlotStatus = "ready" | "todo" | "over";

export type DeepLinkState = {
  activity: string | null;
  honor: string | null;
};
