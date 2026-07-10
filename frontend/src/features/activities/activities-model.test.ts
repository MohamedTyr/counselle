import {
  commonAppCharacterCount,
  getActivityMissingFields,
  isActivityOverLimit,
  isActivityReady,
  isHonorReady,
  type Activity,
  type Honor,
} from "@/domain/activity";
import {
  readDeepLink,
  resolveActiveIds,
  resolveInitialTab,
} from "@/features/activities/activities-deep-link";
import {
  createActivity,
  createHonor,
  getActivityStats,
  getHonorStats,
  insertAt,
  removeById,
  updateItemById,
} from "@/features/activities/activities-mutations";
import {
  renumber,
  reorderById,
  swapByIndex,
  toggleValue,
} from "@/features/activities/activities-reorder";

const timestamp = "2026-07-01T12:00:00.000Z";

function activity(
  overrides: Partial<Activity> & Pick<Activity, "id" | "order">,
): Activity {
  const { id, order, ...rest } = overrides;

  return {
    created_at: "2026-06-01T09:00:00.000Z",
    description:
      "Led the team to a regional title with a 12-person build crew.",
    grades: ["11"],
    hours_per_week: 10,
    id,
    order,
    organization: "Robotics Club",
    position: "Founder",
    timing: ["school_year"],
    type: "Robotics",
    updated_at: "2026-06-01T09:00:00.000Z",
    weeks_per_year: 30,
    ...rest,
  };
}

function honor(overrides: Partial<Honor> & Pick<Honor, "id" | "order">): Honor {
  const { id, order, ...rest } = overrides;

  return {
    created_at: "2026-06-01T09:00:00.000Z",
    grades: ["11"],
    id,
    levels: ["national"],
    order,
    title: "National Physics Olympiad - Silver Medal",
    updated_at: "2026-06-01T09:00:00.000Z",
    ...rest,
  };
}

describe("reorder helpers", () => {
  const items = [
    activity({ id: "a", order: 1 }),
    activity({ id: "b", order: 2 }),
    activity({ id: "c", order: 3 }),
  ];

  it("reorders by dragging one id onto another", () => {
    expect(reorderById(items, "a", "c").map((item) => item.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("returns the original array when dragging onto itself", () => {
    expect(reorderById(items, "a", "a")).toBe(items);
  });

  it("swaps neighbours by index and clamps at the edges", () => {
    expect(swapByIndex(items, 0, 1).map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(swapByIndex(items, 0, -1)).toBe(items);
    expect(swapByIndex(items, 2, 1)).toBe(items);
  });

  it("renumbers order to match position without mutating settled records", () => {
    const shuffled = [
      activity({ id: "a", order: 3 }),
      activity({ id: "b", order: 2 }),
      activity({ id: "c", order: 1 }),
    ];
    const renumbered = renumber(shuffled);

    expect(renumbered.map((item) => item.order)).toEqual([1, 2, 3]);
    expect(renumbered[1]).toBe(shuffled[1]);
  });

  it("toggles multi-select values immutably", () => {
    expect(toggleValue(["9", "10"], "11")).toEqual(["9", "10", "11"]);
    expect(toggleValue(["9", "10"], "10")).toEqual(["9"]);
  });
});

describe("readiness, limits, and missing fields", () => {
  it("counts Common App characters as Unicode code points", () => {
    const description = `${"a".repeat(149)}😀`;

    expect(commonAppCharacterCount(description)).toBe(150);
    expect(
      isActivityOverLimit(
        activity({ description, id: "emoji-limit", order: 1 }),
      ),
    ).toBe(false);
  });

  it("computes missing fields in fill order", () => {
    expect(
      getActivityMissingFields(
        activity({
          grades: [],
          hours_per_week: undefined,
          id: "blank",
          order: 1,
          organization: "",
          position: "",
        }),
      ),
    ).toEqual(["Position", "Organization", "Grades", "Hours/week"]);
  });

  it("marks a fully filled activity as paste-ready", () => {
    expect(isActivityReady(activity({ id: "ready", order: 1 }))).toBe(true);
    expect(
      isActivityReady(activity({ description: "", id: "empty", order: 1 })),
    ).toBe(false);
  });

  it("treats out-of-range time values as not paste-ready", () => {
    expect(
      getActivityMissingFields(
        activity({
          hours_per_week: 0,
          id: "zero-hours",
          order: 1,
          weeks_per_year: 0,
        }),
      ),
    ).toEqual(["Hours/week", "Weeks/year"]);
    expect(
      isActivityReady(
        activity({
          hours_per_week: 0,
          id: "zero-time",
          order: 1,
          weeks_per_year: 0,
        }),
      ),
    ).toBe(false);
  });

  it("summarises activity and honor stats", () => {
    const activities = [
      activity({ id: "ready", order: 1 }),
      activity({ description: "", id: "not-ready", order: 2 }),
      activity({
        description: "x".repeat(200),
        id: "over",
        order: 3,
      }),
    ];

    expect(getActivityStats(activities)).toEqual({
      notReady: 2,
      overLimit: 1,
      ready: 1,
    });

    const honors = [
      honor({ id: "ready", order: 1 }),
      honor({ id: "over", order: 2, title: "y".repeat(120) }),
    ];

    expect(getHonorStats(honors)).toEqual({
      notReady: 1,
      overLimit: 1,
      ready: 1,
    });
    expect(isHonorReady(honors[0])).toBe(true);
  });
});

describe("activity and honor mutations", () => {
  const activities = [
    activity({ id: "first", order: 1 }),
    activity({ id: "second", order: 2 }),
    activity({ id: "third", order: 3 }),
  ];

  it("patches an item by id and touches updated_at without mutating siblings", () => {
    const next = updateItemById(
      activities,
      "second",
      { position: "President" },
      timestamp,
    );

    expect(next[1]).toMatchObject({
      position: "President",
      updated_at: timestamp,
    });
    expect(next[0]).toBe(activities[0]);
    expect(next[2]).toBe(activities[2]);
  });

  it("removes an item, renumbers, and reports index for undo", () => {
    const removed = removeById(activities, "second");

    expect(removed).not.toBeNull();
    expect(removed?.index).toBe(1);
    expect(removed?.item.id).toBe("second");
    expect(removed?.next.map((item) => [item.id, item.order])).toEqual([
      ["first", 1],
      ["third", 2],
    ]);
    expect(removeById(activities, "missing")).toBeNull();
  });

  it("re-inserts a removed item at its original slot and renumbers", () => {
    const removed = removeById(activities, "second");
    const restored = insertAt(removed!.next, removed!.item, removed!.index);

    expect(restored.map((item) => [item.id, item.order])).toEqual([
      ["first", 1],
      ["second", 2],
      ["third", 3],
    ]);
  });

  it("creates activities and honors ranked after the current list", () => {
    const created = createActivity(2, timestamp, "activity-id");

    expect(created).toMatchObject({
      id: "activity-id",
      order: 3,
      position: "",
      type: "Other Club/Activity",
      updated_at: timestamp,
    });

    const createdHonor = createHonor(4, timestamp, "honor-id");

    expect(createdHonor).toMatchObject({
      id: "honor-id",
      levels: [],
      order: 5,
      title: "",
    });
  });
});

describe("deep-link search-param parsing", () => {
  const activities = [activity({ id: "robotics-founder", order: 1 })];
  const honors = [honor({ id: "physics-olympiad", order: 1 })];

  it("reads activity and honor params from the query string", () => {
    expect(
      readDeepLink(new URLSearchParams("activity=robotics-founder")),
    ).toEqual({ activity: "robotics-founder", honor: null });
    expect(readDeepLink(new URLSearchParams("honor=physics-olympiad"))).toEqual(
      { activity: null, honor: "physics-olympiad" },
    );
  });

  it("resolves the active activity drawer for a valid deep link", () => {
    expect(
      resolveActiveIds(
        { activity: "robotics-founder", honor: null },
        activities,
        honors,
      ),
    ).toEqual({ activeActivityId: "robotics-founder", activeHonorId: null });
  });

  it("resolves the active honor drawer for a valid deep link", () => {
    expect(
      resolveActiveIds(
        { activity: null, honor: "physics-olympiad" },
        activities,
        honors,
      ),
    ).toEqual({ activeActivityId: null, activeHonorId: "physics-olympiad" });
  });

  it("lets an activity deep link win over an honor deep link", () => {
    expect(
      resolveActiveIds(
        { activity: "robotics-founder", honor: "physics-olympiad" },
        activities,
        honors,
      ),
    ).toEqual({
      activeActivityId: "robotics-founder",
      activeHonorId: null,
    });
  });

  it("ignores ids that no longer resolve to a record", () => {
    expect(
      resolveActiveIds(
        { activity: "ghost", honor: "gone" },
        activities,
        honors,
      ),
    ).toEqual({ activeActivityId: null, activeHonorId: null });
  });

  it("selects the initial tab from whichever deep link resolves", () => {
    expect(
      resolveInitialTab(
        { activity: "robotics-founder", honor: null },
        activities,
        honors,
      ),
    ).toBe("activities");
    expect(
      resolveInitialTab(
        { activity: null, honor: "physics-olympiad" },
        activities,
        honors,
      ),
    ).toBe("honors");
    expect(
      resolveInitialTab({ activity: null, honor: "gone" }, activities, honors),
    ).toBe("activities");
  });
});
