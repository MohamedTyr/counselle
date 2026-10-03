// The wire shape of `GET /v1/calendar/school-deadlines` (app/facts/calendar.py).

export type CalendarRound = "ED" | "ED2" | "EA" | "EA2" | "RD";

export type SchoolDeadlineItem = {
  unitid: number;
  school_name: string;
  website_url: string | null;
  round: CalendarRound;
  date: string;
  checked_at: string;
};

export type SchoolDeadlineCalendar = {
  cycle_year: number;
  /** `2026-27` — the cycle every date in `items` was reported for. */
  reported_period: string;
  schools_with_dates: number;
  schools_total: number;
  items: SchoolDeadlineItem[];
};
