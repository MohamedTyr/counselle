import { createConcurrencyQueue } from "@/features/cds-admin/upload/concurrency-queue";

describe("createConcurrencyQueue", () => {
  it("never runs more than `limit` tasks at once", async () => {
    const queue = createConcurrencyQueue(2);
    let active = 0;
    let maxActive = 0;

    function task(): Promise<void> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        setTimeout(() => {
          active -= 1;
          resolve();
        }, 10);
      });
    }

    await Promise.all(
      Array.from({ length: 6 }, () => queue.add(() => task())),
    );

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("resolves each task's own value", async () => {
    const queue = createConcurrencyQueue(4);
    const results = await Promise.all([
      queue.add(() => Promise.resolve("a")),
      queue.add(() => Promise.resolve("b")),
    ]);
    expect(results).toEqual(["a", "b"]);
  });

  it("isolates one task's rejection from the others — one bad file never blocks the batch", async () => {
    const queue = createConcurrencyQueue(2);
    const outcomes = await Promise.allSettled([
      queue.add(() => Promise.reject(new Error("boom"))),
      queue.add(() => Promise.resolve("ok")),
    ]);
    expect(outcomes[0].status).toBe("rejected");
    expect(outcomes[1]).toEqual({ status: "fulfilled", value: "ok" });
  });
});
