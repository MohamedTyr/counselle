import { useCallback, useMemo, useState } from "react"
import { useSearchParams } from "react-router"

import type { Activity, Honor } from "@/domain/activity"
import {
  readDeepLink,
  resolveActiveIds,
  resolveInitialTab,
} from "@/features/activities/activities-deep-link"
import type { ActivitiesTab } from "@/features/activities/activities-types"

type UseActivitiesDeepLinkArgs = {
  activities: Activity[]
  honors: Honor[]
}

// Owns the ?activity=<id> / ?honor=<id> URL contract and the active tab. A deep
// link opens the matching drawer on load; open/close mutate the URL in place.
export function useActivitiesDeepLink({
  activities,
  honors,
}: UseActivitiesDeepLinkArgs) {
  const [searchParams, setSearchParams] = useSearchParams()

  const deepLink = useMemo(() => readDeepLink(searchParams), [searchParams])
  const { activeActivityId, activeHonorId } = useMemo(
    () => resolveActiveIds(deepLink, activities, honors),
    [deepLink, activities, honors]
  )

  const [activeTab, setActiveTab] = useState<ActivitiesTab>(() =>
    resolveInitialTab(readDeepLink(searchParams), activities, honors)
  )

  const visibleTab: ActivitiesTab = activeActivityId
    ? "activities"
    : activeHonorId
      ? "honors"
      : activeTab

  const syncDeepLink = useCallback(
    (param: "activity" | "honor", id: string | null) => {
      setSearchParams(
        (currentParams) => {
          const nextParams = new URLSearchParams(currentParams)
          nextParams.delete("activity")
          nextParams.delete("honor")

          if (id) {
            nextParams.set(param, id)
          }

          return nextParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const openActivity = useCallback(
    (id: string) => {
      setActiveTab("activities")
      syncDeepLink("activity", id)
    },
    [syncDeepLink]
  )

  const openHonor = useCallback(
    (id: string) => {
      setActiveTab("honors")
      syncDeepLink("honor", id)
    },
    [syncDeepLink]
  )

  const closeActivity = useCallback(
    () => syncDeepLink("activity", null),
    [syncDeepLink]
  )

  const closeHonor = useCallback(
    () => syncDeepLink("honor", null),
    [syncDeepLink]
  )

  return {
    activeActivityId,
    activeHonorId,
    closeActivity,
    closeHonor,
    openActivity,
    openHonor,
    setActiveTab,
    visibleTab,
  }
}
