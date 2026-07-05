import {
  CalendarClock,
  ClipboardCheck,
  LibraryBig,
  ListChecks,
  School,
} from "lucide-react"

import type { Route } from "@/components/sidebar-02/nav-main"

export const shellRoutes: Route[] = [
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
