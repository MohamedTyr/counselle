import { SchoolsPage as SchoolsFeaturePage } from "@/features/schools/SchoolsRoute"
import { schools } from "@/fixtures/schools"

export function SchoolsPage() {
  return <SchoolsFeaturePage schools={schools} />
}
