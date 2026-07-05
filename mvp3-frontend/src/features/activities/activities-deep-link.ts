import type { Activity, Honor } from "@/domain/activity"
import type {
  ActivitiesTab,
  DeepLinkState,
} from "@/features/activities/activities-types"

// Deep-link contract: ?activity=<id> or ?honor=<id> opens the drawer on load.
export function readDeepLink(params: URLSearchParams): DeepLinkState {
  return { activity: params.get("activity"), honor: params.get("honor") }
}

// An activity deep link wins over an honor deep link; ids must resolve to a
// record that still exists, otherwise the drawer stays closed.
export function resolveActiveIds(
  deepLink: DeepLinkState,
  activities: Activity[],
  honors: Honor[]
): { activeActivityId: string | null; activeHonorId: string | null } {
  const activeActivityId =
    deepLink.activity &&
    activities.some((item) => item.id === deepLink.activity)
      ? deepLink.activity
      : null

  const activeHonorId =
    !activeActivityId &&
    deepLink.honor &&
    honors.some((item) => item.id === deepLink.honor)
      ? deepLink.honor
      : null

  return { activeActivityId, activeHonorId }
}

// The tab shown on first load matches whichever deep link resolves to a record.
export function resolveInitialTab(
  deepLink: DeepLinkState,
  activities: Activity[],
  honors: Honor[]
): ActivitiesTab {
  const activityValid =
    !!deepLink.activity &&
    activities.some((item) => item.id === deepLink.activity)

  if (activityValid) {
    return "activities"
  }

  const honorValid =
    !!deepLink.honor && honors.some((item) => item.id === deepLink.honor)

  return honorValid ? "honors" : "activities"
}
