import type { ReactNode } from "react";
import { DatabaseZap } from "lucide-react";

import calIcon from "@/assets/app-shell/cal.svg";
import capIcon from "@/assets/app-shell/cap.svg";
import checkIcon from "@/assets/app-shell/check.svg";
import fileIcon from "@/assets/app-shell/file.svg";
import listIcon from "@/assets/app-shell/list.svg";
import sparklesIcon from "@/assets/app-shell/sparkles.svg";
import userIcon from "@/assets/app-shell/user.svg";

export type ShellRoute = {
  id: string;
  title: string;
  link: string;
  icon: ReactNode;
  /** Fill of the 26px tile behind the icon. */
  tile: string;
  /** Tile fill while the route is current, when it differs from `tile`. */
  tileActive?: string;
  /** Exact-match instead of prefix-match when computing the current route. */
  end?: boolean;
};

function tileIcon(src: string) {
  return <img alt="" height={18} src={src} width={18} />;
}

/*
 * Order is grouped by mental model: AI first (it owns the chat list under
 * this nav), then the application objects a student works on, then the
 * time-bound work, then Profile. Tile colours are the Figma frame's.
 */
export const shellRoutes: ShellRoute[] = [
  { id: "ai", title: "AI", link: "/app/ai", icon: tileIcon(sparklesIcon), tile: "#e9f8ef", tileActive: "#d0f0dd" },
  { id: "schools", title: "Schools", link: "/app/schools", icon: tileIcon(capIcon), tile: "#e9f8ef", tileActive: "#d0f0dd" },
  { id: "essays", title: "Essays", link: "/app/essays", icon: tileIcon(fileIcon), tile: "#fdf0de" },
  { id: "activities", title: "Activities", link: "/app/activities", icon: tileIcon(listIcon), tile: "#eee9fe" },
  { id: "tasks", title: "Tasks", link: "/app/tasks", icon: tileIcon(checkIcon), tile: "#e5f0fe" },
  { id: "calendar", title: "Calendar", link: "/app/calendar", icon: tileIcon(calIcon), tile: "#fdecea" },
  { id: "profile", title: "Profile", link: "/app/profile", icon: tileIcon(userIcon), tile: "#def7f3" },
];

/** Appended to `shellRoutes` only when the user is a superuser. */
export const adminShellRoutes: ShellRoute[] = [
  {
    id: "cds",
    title: "CDS",
    link: "/app/admin/facts",
    icon: <DatabaseZap color="#4e5754" strokeWidth={1.5} />,
    tile: "#eff1f0",
  },
];
