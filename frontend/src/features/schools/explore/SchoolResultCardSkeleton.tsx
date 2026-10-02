import { Skeleton } from "@/components/ui/skeleton";

/**
 * Matches the real card's block rhythm — logo and action / name / the two
 * figures — so the layout does not shift when data lands. It borrows the
 * card's neutral wash, the one a school without a known colour gets.
 */
export function SchoolResultCardSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 rounded-[18px] p-4"
      data-slot="school-card"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="size-11 rounded-xl" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        {[0, 1].map((column) => (
          <div className="space-y-1.5" key={column}>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
