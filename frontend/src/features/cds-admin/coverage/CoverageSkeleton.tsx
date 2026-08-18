import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the loaded geometry exactly (DESIGN.md §1.7) so nothing jumps
 * when data lands: counters line, filter bar, then a bordered grid frame
 * with a head row and six body rows. */
export function CoverageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Skeleton className="mt-4 h-4 w-80" />
      <Skeleton className="mt-3 h-8 w-full max-w-2xl" />
      <div className="mt-5 min-h-0 flex-1 pb-6">
        <div className="h-full space-y-px overflow-hidden rounded-xl border">
          <Skeleton className="h-10 w-full rounded-none" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton className="h-11 w-full rounded-none" key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
