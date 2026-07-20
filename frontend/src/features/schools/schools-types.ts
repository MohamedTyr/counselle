export type ViewFilter = "all" | "applying" | "submitted" | "deadlines-soon";
export type ListTypeFilter = "all" | "reach" | "target" | "safety";

export type ColumnId =
  | "school"
  | "status"
  | "listType"
  | "round"
  | "nextDeadline"
  | "progress"
  | "essays";

export type TableColumn = {
  id: ColumnId;
  label: string;
  minWidth: number;
  maxWidth: number;
};

export type ColumnWidths = Record<ColumnId, number>;
export type SortDirection = "asc" | "desc";

export type SortState = {
  columnId: ColumnId;
  direction: SortDirection;
};

export type ScrollThumbState = {
  height: number;
  top: number;
  visible: boolean;
};
