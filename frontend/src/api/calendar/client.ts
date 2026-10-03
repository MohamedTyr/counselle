import type { SchoolDeadlineCalendar } from "@/api/calendar/types";
import { requestJson } from "@/api/http/client";

export function getSchoolDeadlines(): Promise<SchoolDeadlineCalendar> {
  return requestJson<SchoolDeadlineCalendar>("/calendar/school-deadlines");
}
