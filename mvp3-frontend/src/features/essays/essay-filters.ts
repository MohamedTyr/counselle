import type { EssayLibraryCardData } from "@/domain/essay"
import type { Option } from "@/domain/shared"

export type EssayFilter =
  "all" | "personal" | "supplements" | "review" | "due-soon"

export const filterOptions: Option<EssayFilter>[] = [
  { value: "all", label: "All" },
  { value: "personal", label: "Personal statement" },
  { value: "supplements", label: "Supplements" },
  { value: "review", label: "Needs review" },
  { value: "due-soon", label: "Due soon" },
]

export function matchesFilter(
  essay: EssayLibraryCardData,
  filter: EssayFilter
) {
  if (filter === "personal") {
    return essay.type === "Personal statement"
  }

  if (filter === "supplements") {
    return essay.type === "Supplement"
  }

  if (filter === "review") {
    return essay.status === "Needs review" || essay.suggestions > 0
  }

  if (filter === "due-soon") {
    return essay.dueSoon === true
  }

  return true
}

export function getEssaySearchText(essay: EssayLibraryCardData) {
  return `${essay.title} ${essay.school} ${essay.type}`.toLowerCase()
}

export function countEssaysByFilter(
  essays: EssayLibraryCardData[],
  filter: EssayFilter
) {
  return essays.filter((essay) => matchesFilter(essay, filter)).length
}

export function filterEssays(
  essays: EssayLibraryCardData[],
  filter: EssayFilter,
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase()

  return essays.filter((essay) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      getEssaySearchText(essay).includes(normalizedQuery)

    return matchesQuery && matchesFilter(essay, filter)
  })
}
