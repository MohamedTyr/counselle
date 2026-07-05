import type { ElementType } from "react"

import { Logo } from "@/components/sidebar-02/logo"

export type ShellNotification = {
  id: string
  avatar: string
  fallback: string
  text: string
  time: string
}

export type ShellTeam = {
  id: string
  name: string
  logo: ElementType
  plan: string
}

export const shellNotifications: ShellNotification[] = [
  {
    id: "1",
    avatar: "/avatars/01.png",
    fallback: "NY",
    text: "NYU Regular Decision deadline is pinned for Jan 5.",
    time: "10m ago",
  },
  {
    id: "2",
    avatar: "/avatars/02.png",
    fallback: "UC",
    text: "UC Berkeley admit-rate data refreshed from official sources.",
    time: "1h ago",
  },
  {
    id: "3",
    avatar: "/avatars/03.png",
    fallback: "EA",
    text: "Three Early Action tasks need review this week.",
    time: "2h ago",
  },
]

export const shellTeams: ShellTeam[] = [
  { id: "1", name: "Class of 2027", logo: Logo, plan: "Undergrad" },
  { id: "2", name: "International list", logo: Logo, plan: "Fall 2027" },
  { id: "3", name: "Transfer plan", logo: Logo, plan: "Spring 2028" },
]
