import type { School } from "@/domain/school";
import { getDeadlineUrgency } from "@/features/schools/schools-deadline";
import type {
  ListTypeFilter,
  ViewFilter,
} from "@/features/schools/schools-types";

export function isDeadlineSoon(school: School) {
  const deadlineUrgency = getDeadlineUrgency(school.deadline);
  return deadlineUrgency === "close" || deadlineUrgency === "upcoming";
}

export function matchesViewFilter(school: School, viewFilter: ViewFilter) {
  if (viewFilter === "applying") {
    return school.status === "Applying" || school.status === "Deferred";
  }

  if (viewFilter === "submitted") {
    return school.status === "Submitted";
  }

  if (viewFilter === "deadlines-soon") {
    return isDeadlineSoon(school);
  }

  return true;
}

export function matchesListTypeFilter(
  school: School,
  listTypeFilter: ListTypeFilter,
) {
  if (listTypeFilter === "all") {
    return true;
  }

  return school.listType.toLowerCase() === listTypeFilter;
}

export function filterSchools(
  schools: School[],
  viewFilter: ViewFilter,
  listTypeFilter: ListTypeFilter,
) {
  return schools.filter(
    (school) =>
      matchesViewFilter(school, viewFilter) &&
      matchesListTypeFilter(school, listTypeFilter),
  );
}
