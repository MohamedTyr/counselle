import {
  CalendarClock,
  ClipboardCheck,
  LibraryBig,
  ListChecks,
  School,
} from "lucide-react"

import type { ShellRoute } from "@/features/shell/MainNav"

export const shellRoutes: ShellRoute[] = [
  {
    id: "schools",
    title: "Schools",
    icon: <School />,
    link: "/schools",
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: <ClipboardCheck />,
    link: "/tasks",
  },
  {
    id: "calendar",
    title: "Calendar",
    icon: <CalendarClock />,
    link: "/calendar",
  },
  {
    id: "activities",
    title: "Activities",
    icon: <ListChecks />,
    link: "/activities",
  },
  {
    id: "essays",
    title: "Essays",
    icon: <LibraryBig />,
    link: "/essays",
  },
]
