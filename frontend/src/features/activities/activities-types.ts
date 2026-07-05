import type { Dispatch, SetStateAction } from "react";

import type { Activity, Honor } from "@/domain/activity";

export type ActivitiesPageProps = {
  activities?: Activity[];
  onActivitiesChange?: Dispatch<SetStateAction<Activity[]>>;
  honors?: Honor[];
  onHonorsChange?: Dispatch<SetStateAction<Honor[]>>;
};

export type PendingDelete =
  | { kind: "activity"; item: Activity; index: number }
  | { kind: "honor"; item: Honor; index: number }
  | null;

export type ActivitiesTab = "activities" | "honors";

export type SectionStats = {
  notReady: number;
  overLimit: number;
  ready: number;
};

export type DeepLinkState = {
  activity: string | null;
  honor: string | null;
};
