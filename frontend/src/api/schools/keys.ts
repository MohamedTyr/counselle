export const schoolFactsKeys = {
  all: ["school-facts"] as const,
  detail: (unitid: number) => [...schoolFactsKeys.all, "detail", unitid] as const,
};
