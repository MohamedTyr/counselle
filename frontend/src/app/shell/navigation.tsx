import {
  Bot,
  CalendarClock,
  ClipboardCheck,
  IdCard,
  LibraryBig,
  ListChecks,
  School,
} from "lucide-react";

import type { ShellRoute } from "@/features/shell/MainNav";

/*
 * Order is grouped by mental model, not alphabetically: AI first (it owns
 * the chat list rendered directly beneath this nav), then the application
 * objects a student works ON (Schools, Essays, Activities), then the
 * time-bound work (Tasks, Calendar), then Profile — account-scoped, so it
 * sits last even though it stays a top-level destination.
 */
export const shellRoutes: ShellRoute[] = [
  {
    id: "ai",
    title: "AI",
    icon: <Bot />,
    link: "/app/ai",
  },
  {
    id: "schools",
    title: "Schools",
    icon: <School />,
    link: "/app/schools",
  },
  {
    id: "essays",
    title: "Essays",
    icon: <LibraryBig />,
    link: "/app/essays",
  },
  {
    id: "activities",
    title: "Activities",
    icon: <ListChecks />,
    link: "/app/activities",
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: <ClipboardCheck />,
    link: "/app/tasks",
  },
  {
    id: "calendar",
    title: "Calendar",
    icon: <CalendarClock />,
    link: "/app/calendar",
  },
  {
    id: "profile",
    title: "Profile",
    icon: <IdCard />,
    link: "/app/profile",
  },
];
