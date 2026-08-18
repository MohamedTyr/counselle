import {
  ActivitiesIcon,
  AiIcon,
  CalendarIcon,
  EssaysIcon,
  ProfileIcon,
  SchoolsIcon,
  TasksIcon,
} from "@/features/shell/sidebar-icons";
import { DatabaseZap } from "lucide-react";

import type { ShellRoute } from "@/features/shell/MainNav";

/*
 * Order is grouped by mental model, not alphabetically: AI first (it owns
 * the chat list rendered directly beneath this nav), then the application
 * objects a student works ON (Schools, Essays, Activities), then the
 * time-bound work (Tasks, Calendar), then Profile — account-scoped, so it
 * sits last even though it stays a top-level destination.
 *
 * This is also, exactly, variant 1a's order and label set. Icons come from
 * sidebar-icons.tsx (1a's own glyphs) rather than lucide — see the note in
 * that file.
 */
export const shellRoutes: ShellRoute[] = [
  {
    id: "ai",
    title: "AI",
    icon: <AiIcon />,
    link: "/app/ai",
  },
  {
    id: "schools",
    title: "Schools",
    icon: <SchoolsIcon />,
    link: "/app/schools",
  },
  {
    id: "essays",
    title: "Essays",
    icon: <EssaysIcon />,
    link: "/app/essays",
  },
  {
    id: "activities",
    title: "Activities",
    icon: <ActivitiesIcon />,
    link: "/app/activities",
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: <TasksIcon />,
    link: "/app/tasks",
  },
  {
    id: "calendar",
    title: "Calendar",
    icon: <CalendarIcon />,
    link: "/app/calendar",
  },
  {
    id: "profile",
    title: "Profile",
    icon: <ProfileIcon />,
    link: "/app/profile",
  },
];

/** Appended to `shellRoutes` by `AppSidebar` only when `is_superuser` is
 * true (plan §F1) — one entry, not a section. */
export const adminShellRoutes: ShellRoute[] = [
  {
    id: "cds",
    title: "CDS",
    icon: <DatabaseZap />,
    link: "/app/admin/cds",
  },
];
