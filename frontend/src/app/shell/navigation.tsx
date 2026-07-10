import {
  Bot,
  CalendarClock,
  ClipboardCheck,
  IdCard,
  LibraryBig,
  ListChecks,
  School,
} from "lucide-react"

import type { ShellRoute } from "@/features/shell/MainNav"

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
    id: "tasks",
    title: "Tasks",
    icon: <ClipboardCheck />,
    link: "/app/tasks",
  },
  {
    id: "profile",
    title: "Profile",
    icon: <IdCard />,
    link: "/app/profile",
  },
  {
    id: "calendar",
    title: "Calendar",
    icon: <CalendarClock />,
    link: "/app/calendar",
  },
  {
    id: "activities",
    title: "Activities",
    icon: <ListChecks />,
    link: "/app/activities",
  },
  {
    id: "essays",
    title: "Essays",
    icon: <LibraryBig />,
    link: "/app/essays",
  },
]
