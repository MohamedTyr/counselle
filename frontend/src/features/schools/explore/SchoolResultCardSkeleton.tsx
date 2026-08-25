import { Skeleton } from "@/components/ui/skeleton";

/**
 * Matches the real card's block rhythm — header / band / stats / footer —
 * so the layout does not shift when data lands. A spinner would tell the
 * user something is happening and nothing about what is arriving.
 */
export function SchoolResultCardSkeleton() {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--school-card-border)] bg-[var(--school-card-surface)] p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-7 w-14 rounded-md" />
      </div>

      <div className="-mx-4 mt-4 space-y-2 border-y px-4 py-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5.5 w-20" />
        </div>
        <Skeleton className="h-3 w-2/3" />
      </div>

      {/* Value block above label block, matching the real cell's ordering —
       * a skeleton that reverses the emphasis reshuffles on load. */}
      <div className="grid grid-cols-3 gap-3 py-4">
        {[0, 1, 2].map((column) => (
          <div className="space-y-1.5" key={column}>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>

      <div className="-mx-4 flex items-center justify-between border-t px-4 pt-2.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}
