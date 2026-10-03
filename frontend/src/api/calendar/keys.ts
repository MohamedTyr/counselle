export const calendarKeys = {
  all: ["calendar"] as const,
  schoolDeadlines: () => [...calendarKeys.all, "school-deadlines"] as const,
};
