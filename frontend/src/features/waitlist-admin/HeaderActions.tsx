import { useEffect, useState } from "react";
import type React from "react";
import { CheckIcon, CopyIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { WaitlistRow } from "@/features/landing/waitlist/contract";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { dayKey, plural, toCsv } from "./derive";

const COPIED_HOLD_MS = 1200;
const ICON =
  "absolute inset-0 m-auto size-4 transition-[opacity,scale,filter] duration-150 ease-out motion-reduce:transition-opacity";
const HIDDEN =
  "scale-25 opacity-0 blur-xs motion-reduce:scale-100 motion-reduce:blur-none";

/** Copy and check stay in the DOM and cross-fade, so the swap has an exit
 * as well as an enter. The toast is the static cue. */
function CopyGlyph({ copied }: { copied: boolean }) {
  return (
    <span aria-hidden="true" className="relative inline-flex size-4">
      <CopyIcon className={cn(ICON, copied && HIDDEN)} />
      <CheckIcon className={cn(ICON, !copied && HIDDEN)} />
    </span>
  );
}

function download(rows: WaitlistRow[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `acceptra-waitlist-${dayKey(new Date())}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function HeaderActions({
  rows,
  filtered,
  fetching,
  onRefresh,
}: {
  rows: WaitlistRow[] | null;
  filtered: boolean;
  fetching: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  const isMobile = useIsMobile();
  // A stamp, not a flag, so a second copy restarts the hold.
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const copied = copiedAt !== null;
  const count = rows?.length ?? 0;
  const empty = count === 0;

  useEffect(() => {
    if (copiedAt === null) return;
    const timeout = window.setTimeout(() => setCopiedAt(null), COPIED_HOLD_MS);
    return () => window.clearTimeout(timeout);
  }, [copiedAt]);

  async function copyEmails() {
    if (!rows) return;
    try {
      await navigator.clipboard.writeText(
        rows.map((row) => row.email).join("\n"),
      );
      setCopiedAt(Date.now());
      toast.success(`Copied ${plural(count, "email")}`);
    } catch {
      toast.error("Could not copy the emails");
    }
  }

  const copyLabel = filtered ? `Copy ${plural(count, "email")}` : "Copy emails";
  const exportLabel = filtered
    ? `Export ${count.toLocaleString()}`
    : "Export CSV";
  const size = isMobile ? "icon" : "default";

  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={isMobile ? copyLabel : undefined}
        disabled={empty}
        onClick={() => void copyEmails()}
        size={size}
        variant="outline"
      >
        <CopyGlyph copied={copied} />
        {isMobile ? null : copyLabel}
      </Button>
      <Button
        aria-label={isMobile ? exportLabel : undefined}
        disabled={empty}
        onClick={() => rows && download(rows)}
        size={size}
        variant="outline"
      >
        <DownloadIcon aria-hidden="true" />
        {isMobile ? null : exportLabel}
      </Button>
      <Button
        aria-label="Refresh"
        onClick={onRefresh}
        size="icon"
        variant="ghost"
      >
        <RefreshCwIcon
          aria-hidden="true"
          className={cn(fetching && "motion-safe:animate-spin")}
        />
      </Button>
    </div>
  );
}
