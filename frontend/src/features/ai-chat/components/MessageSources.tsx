import { BookOpenIcon } from "lucide-react";

import type { MessageSourcesPayload, ReplaySourceEntry, SourceFocus } from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { sourceDisplayName, sourcesPayloadFor } from "../citations";
import type { AssistantChatMessage } from "../model";

export type { MessageSourcesPayload } from "@/api/chat/types";

export type MessageSourcesProps = {
  message: Pick<AssistantChatMessage, "blocks" | "text" | "sources" | "turnStatus">;
  onOpen?: (payload: MessageSourcesPayload) => void;
  active?: SourceFocus;
};

const MAX_BADGES = 3;

function SourceBadge({ entry, stacked }: { entry: ReplaySourceEntry; stacked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[26px] shrink-0 place-items-center rounded-full border bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background",
        stacked && "-ml-2.5",
      )}
      title={sourceDisplayName(entry)}
    >
      {sourceDisplayName(entry).slice(0, 1).toUpperCase()}
    </span>
  );
}

export function MessageSources({ message, onOpen, active }: MessageSourcesProps) {
  if (message.turnStatus !== "complete" && message.turnStatus !== "cancelled") return null;
  const payload = sourcesPayloadFor(message, active);
  if (payload === null) return null;

  const countLabel = `${payload.sources.length} ${payload.sources.length === 1 ? "source" : "sources"}`;
  const badges = payload.sources.slice(0, MAX_BADGES);

  return (
    <Button
      aria-label={`View ${countLabel} for this answer`}
      className={cn(
        "not-prose group/strip -mx-2 w-fit max-w-full gap-2 rounded-full px-2",
      )}
      onClick={() => onOpen?.(payload)}
      size="sm"
      type="button"
      variant="ghost"
    >
      <span className="flex shrink-0 items-center">
        {badges.length > 0 ? badges.map((entry, index) => (
          <SourceBadge entry={entry} key={entry.index} stacked={index > 0} />
        )) : <BookOpenIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground transition-colors group-hover/strip:text-foreground">
        {countLabel}
      </span>
    </Button>
  );
}
