import type { ApplicationSupplements } from "@/api/workspace/types";
import { planSupplements } from "@/features/essays/supplements-model";

export function extraPrompts(supplements: ApplicationSupplements) {
  const plan = planSupplements(supplements);
  return [...plan.optional, ...plan.conditional].filter((p) => !p.essay_id);
}

export function shortSource(supplements: ApplicationSupplements) {
  if (supplements.checked === "common_app") return "Checked: Common App";
  if (supplements.checked === "official_site") return "Checked: school site";
  return "Not yet checked";
}
