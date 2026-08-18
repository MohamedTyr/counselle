import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the loaded screen's geometry exactly (§1.7) — the 56px header
 * strip, the two panes, nothing jumps when data lands. */
export function ReviewSkeleton() {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-6 md:px-10">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-h-0 border-r p-6">
          <Skeleton className="aspect-[8.5/11] w-full max-w-2xl" />
        </div>
        <div className="min-h-0 space-y-6 p-6">
          {Array.from({ length: 3 }, (_, section) => (
            <div className="space-y-2" key={section}>
              <Skeleton className="h-9 w-full" />
              {Array.from({ length: 5 }, (__, row) => (
                <Skeleton className="h-7 w-full" key={row} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
