/**
 * A tiny run-N-at-a-time async queue. DESIGN.md §4.8 step 2: "one
 * `POST /admin/cds/uploads` per file, max 4 in flight (`useBatchUpload`)."
 * Kept as a pure, framework-free primitive so it's trivially unit-testable
 * and so `useBatchUpload` doesn't have to reason about scheduling.
 */
export interface ConcurrencyQueue {
  add<T>(task: () => Promise<T>): Promise<T>;
}

export function createConcurrencyQueue(limit: number): ConcurrencyQueue {
  let active = 0;
  const pending: Array<() => void> = [];

  function runNext() {
    if (active >= limit || pending.length === 0) {
      return;
    }
    active += 1;
    const run = pending.shift();
    run?.();
  }

  return {
    add<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        pending.push(() => {
          task()
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              runNext();
            });
        });
        runNext();
      });
    },
  };
}
