import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { AlertTriangle } from "lucide-react"

export function SectionStatus({
  className,
  notReady,
  overLimit,
  ready,
}: {
  className?: string
  notReady: number
  overLimit: number
  ready: number
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Badge className="h-8 px-3 text-[13px]" variant="success">
        {ready} paste-ready
      </Badge>
      {notReady > 0 ? (
        <Badge className="h-8 px-3 text-[13px]" variant="warning">
          {notReady} not ready
        </Badge>
      ) : null}
      {overLimit > 0 ? (
        <Badge
          className="h-8 px-3 text-[13px] [&_svg]:size-3.5"
          variant="error"
        >
          <AlertTriangle aria-hidden="true" />
          {overLimit} over limit
        </Badge>
      ) : null}
    </div>
  )
}
