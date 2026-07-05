import {
  isActivityOverLimit,
  isActivityReady,
  isHonorOverLimit,
  isHonorReady,
  type Activity,
  type Honor,
} from "@/domain/activity"
import { createDemoId, createTimestamp } from "@/domain/time"
import { renumber } from "@/features/activities/activities-reorder"
import type { SectionStats } from "@/features/activities/activities-types"

type Identified = { id: string; order: number }

// Patch an item by id and touch updated_at, without mutating other records.
export function updateItemById<T extends { id: string; updated_at: string }>(
  items: T[],
  id: string,
  patch: Partial<T>,
  timestamp = createTimestamp()
): T[] {
  return items.map((item) =>
    item.id === id ? { ...item, ...patch, updated_at: timestamp } : item
  )
}

// Remove an item by id and renumber. Returns the removed item and its index so
// the caller can offer an undo, or null when the id is not present.
export function removeById<T extends Identified>(
  items: T[],
  id: string
): { index: number; item: T; next: T[] } | null {
  const index = items.findIndex((item) => item.id === id)

  if (index === -1) {
    return null
  }

  const item = items[index]
  const next = renumber(items.filter((current) => current.id !== id))

  return { index, item, next }
}

// Re-insert a removed item at its original slot (clamped) and renumber.
export function insertAt<T extends Identified>(
  items: T[],
  item: T,
  index: number
): T[] {
  const next = [...items]
  next.splice(Math.min(index, next.length), 0, item)
  return renumber(next)
}

export function createActivity(
  length: number,
  timestamp = createTimestamp(),
  id = createDemoId("activity")
): Activity {
  return {
    created_at: timestamp,
    description: "",
    grades: [],
    id,
    order: length + 1,
    organization: "",
    position: "",
    timing: [],
    type: "Other Club/Activity",
    updated_at: timestamp,
  }
}

export function createHonor(
  length: number,
  timestamp = createTimestamp(),
  id = createDemoId("honor")
): Honor {
  return {
    created_at: timestamp,
    grades: [],
    id,
    levels: [],
    order: length + 1,
    title: "",
    updated_at: timestamp,
  }
}

export function getActivityStats(activities: Activity[]): SectionStats {
  let ready = 0
  let overLimit = 0

  activities.forEach((activity) => {
    if (isActivityReady(activity)) {
      ready += 1
    }

    if (isActivityOverLimit(activity)) {
      overLimit += 1
    }
  })

  return { notReady: activities.length - ready, overLimit, ready }
}

export function getHonorStats(honors: Honor[]): SectionStats {
  let ready = 0
  let overLimit = 0

  honors.forEach((honor) => {
    if (isHonorReady(honor)) {
      ready += 1
    }

    if (isHonorOverLimit(honor)) {
      overLimit += 1
    }
  })

  return { notReady: honors.length - ready, overLimit, ready }
}
