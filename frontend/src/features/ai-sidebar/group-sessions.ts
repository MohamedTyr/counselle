import type { ChatSessionSummary } from "@/api/chat/types";

export type SessionGroup = {
  id: string;
  label: string;
  sessions: ChatSessionSummary[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function bucketFor(timestamp: number, todayStart: number) {
  const daysAgo = Math.floor((todayStart - startOfDay(new Date(timestamp))) / DAY_MS);
  if (daysAgo <= 0) {
    return { id: "today", label: "Today", order: 0 };
  }
  if (daysAgo === 1) {
    return { id: "yesterday", label: "Yesterday", order: 1 };
  }
  if (daysAgo <= 7) {
    return { id: "previous-7", label: "Previous 7 days", order: 2 };
  }
  if (daysAgo <= 30) {
    return { id: "previous-30", label: "Previous 30 days", order: 3 };
  }
  return { id: "older", label: "Older", order: 4 };
}

/**
 * Splits sessions into recency buckets (Today, Yesterday, …) ordered
 * newest-first, mirroring the mental model of modern chat sidebars. Sessions
 * within a bucket keep the incoming order (already newest-first from the API).
 */
export function groupSessionsByRecency(
  sessions: ChatSessionSummary[],
): SessionGroup[] {
  const todayStart = startOfDay(new Date());
  const buckets = new Map<string, SessionGroup & { order: number }>();

  for (const session of sessions) {
    const timestamp = Date.parse(session.updatedAt) || Date.parse(session.createdAt);
    const bucket = bucketFor(Number.isNaN(timestamp) ? Date.now() : timestamp, todayStart);
    const existing = buckets.get(bucket.id);
    if (existing) {
      existing.sessions.push(session);
    } else {
      buckets.set(bucket.id, {
        id: bucket.id,
        label: bucket.label,
        order: bucket.order,
        sessions: [session],
      });
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      id: group.id,
      label: group.label,
      sessions: group.sessions,
    }));
}
