import type { ComponentProps } from "react";

import type { Badge } from "@/components/ui/badge";
import type { ApplicationStatus, ListType, Round } from "@/domain/school";
import type { Option } from "@/domain/shared";
import type {
  ColumnWidths,
  ListTypeFilter,
  SortState,
  TableColumn,
  ViewFilter,
} from "@/features/schools/schools-types";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export const defaultColumnWidths: ColumnWidths = {
  school: 292,
  status: 108,
  listType: 108,
  round: 150,
  nextDeadline: 138,
  progress: 126,
  essays: 82,
};

export const tableColumns: TableColumn[] = [
  { id: "school", label: "School", minWidth: 240, maxWidth: 460 },
  { id: "status", label: "Status", minWidth: 96, maxWidth: 180 },
  { id: "listType", label: "List Type", minWidth: 96, maxWidth: 180 },
  { id: "round", label: "Round", minWidth: 132, maxWidth: 240 },
  { id: "nextDeadline", label: "Next Deadline", minWidth: 128, maxWidth: 220 },
  { id: "progress", label: "Progress", minWidth: 118, maxWidth: 180 },
  { id: "essays", label: "Essays", minWidth: 76, maxWidth: 128 },
];

export const defaultSortState: SortState = {
  columnId: "nextDeadline",
  direction: "asc",
};

export const viewFilterOptions: Option<ViewFilter>[] = [
  { value: "all", label: "All" },
  { value: "applying", label: "Applying" },
  { value: "submitted", label: "Submitted" },
  { value: "deadlines-soon", label: "Deadlines soon" },
];

export const listTypeFilterOptions: Option<ListTypeFilter>[] = [
  { value: "all", label: "All types" },
  { value: "reach", label: "Reach" },
  { value: "target", label: "Target" },
  { value: "safety", label: "Safety" },
];

/*
 * Only the four statuses that are actually events get a colour. Submitted /
 * Accepted / Enrolled are the done tier, Rejected is the one bad outcome,
 * Deferred and Waitlisted are the "waiting on them" tier. Considering,
 * Applying and Withdrawn are ordinary states of a row and take the neutral
 * label chip — `Applying` was blue before the palette pass, which coloured
 * the single most common state on the page.
 */
export const statusVariant: Record<ApplicationStatus, BadgeVariant> = {
  Accepted: "success",
  Applying: "secondary",
  Considering: "secondary",
  Deferred: "warning",
  Enrolled: "success",
  Rejected: "error",
  Submitted: "success",
  Waitlisted: "warning",
  Withdrawn: "secondary",
};

/*
 * The fit ladder is a label here, not a state. It was amber / blue / green,
 * which made "Safety" the same green as an accepted application two columns
 * over and "Reach" the same amber as a waitlist — and on an Explore card the
 * amber Reach badge sat directly above an amber low-submission warning.
 *
 * The ladder is ordered data, so its colour lives where the order is
 * legible: three intensity steps of the one brand hue on the list balance
 * bar (--school-balance-* in schools.css). In a table cell or on a card
 * corner the badge is alone in its column and the word does the work.
 */
export const listTypeVariant: Record<ListType, BadgeVariant> = {
  Reach: "secondary",
  Safety: "secondary",
  Target: "secondary",
};

export const statusSortRank: Record<ApplicationStatus, number> = {
  Considering: 1,
  Applying: 2,
  Submitted: 3,
  Deferred: 4,
  Accepted: 5,
  Enrolled: 6,
  Waitlisted: 7,
  Rejected: 8,
  Withdrawn: 9,
};

export const listTypeSortRank: Record<ListType, number> = {
  Reach: 1,
  Target: 2,
  Safety: 3,
};

export const roundSortRank: Record<Round, number> = {
  ED: 1,
  ED2: 2,
  REA: 3,
  EA: 4,
  Priority: 5,
  RD: 6,
  Rolling: 7,
};
