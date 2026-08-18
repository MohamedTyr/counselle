import { Skeleton } from "@/components/ui/skeleton";

/** DESIGN.md §1.7 — only shown when reloading an existing `?batch=`; mirrors
 * the loaded staging row's geometry (`h-14`) exactly so nothing jumps. */
export function BatchSkeleton({ className }: { className?: string }) {
  return (
    <div className={className ? className : "mt-4 space-y-3"}>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
