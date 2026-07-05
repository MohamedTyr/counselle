import type { ComponentProps } from "react"

import type { Badge } from "@/components/ui/badge"
import type { ApplicationStatus, ListType, Round } from "@/domain/school"
import type { Option } from "@/domain/shared"
import type {
  ColumnWidths,
  ListTypeFilter,
  SortState,
  TableColumn,
  ViewFilter,
} from "@/features/schools/schools-types"

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>

export const defaultColumnWidths: ColumnWidths = {
  school: 292,
  status: 108,
  listType: 108,
  round: 150,
  nextDeadline: 138,
  progress: 126,
  essays: 82,
}

export const tableColumns: TableColumn[] = [
  { id: "school", label: "School", minWidth: 240, maxWidth: 460 },
  { id: "status", label: "Status", minWidth: 96, maxWidth: 180 },
  { id: "listType", label: "List Type", minWidth: 96, maxWidth: 180 },
  { id: "round", label: "Round", minWidth: 132, maxWidth: 240 },
  { id: "nextDeadline", label: "Next Deadline", minWidth: 128, maxWidth: 220 },
  { id: "progress", label: "Progress", minWidth: 118, maxWidth: 180 },
  { id: "essays", label: "Essays", minWidth: 76, maxWidth: 128 },
]

export const defaultSortState: SortState = {
  columnId: "nextDeadline",
  direction: "asc",
}

export const viewFilterOptions: Option<ViewFilter>[] = [
  { value: "all", label: "All" },
  { value: "applying", label: "Applying" },
  { value: "submitted", label: "Submitted" },
  { value: "deadlines-soon", label: "Deadlines soon" },
]

export const listTypeFilterOptions: Option<ListTypeFilter>[] = [
  { value: "all", label: "All types" },
  { value: "reach", label: "Reach" },
  { value: "target", label: "Target" },
  { value: "safety", label: "Safety" },
]

export const statusVariant: Record<ApplicationStatus, BadgeVariant> = {
  Considering: "secondary",
  Applying: "info",
  Submitted: "success",
  Accepted: "success",
  Rejected: "error",
  Waitlisted: "warning",
  Withdrawn: "secondary",
}

export const listTypeVariant: Record<ListType, BadgeVariant> = {
  Reach: "warning",
  Target: "info",
  Safety: "success",
}

export const statusSortRank: Record<ApplicationStatus, number> = {
  Considering: 1,
  Applying: 2,
  Submitted: 3,
  Accepted: 4,
  Waitlisted: 5,
  Rejected: 6,
  Withdrawn: 7,
}

export const listTypeSortRank: Record<ListType, number> = {
  Reach: 1,
  Target: 2,
  Safety: 3,
}

export const roundSortRank: Record<Round, number> = {
  ED: 1,
  EA: 2,
  Priority: 3,
  "Scholarship deadline": 4,
  RD: 5,
  Rolling: 6,
}
