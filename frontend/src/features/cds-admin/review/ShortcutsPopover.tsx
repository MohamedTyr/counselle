import { CircleHelp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CommandShortcut } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useReviewControllerContext } from "@/features/cds-admin/review/review-context";

const SHORTCUTS: readonly [string, string][] = [
  ["n / p", "Next / previous unresolved flag"],
  ["j / k", "Next / previous metric row"],
  ["e / ↵", "Edit the focused metric"],
  ["Esc", "Cancel the editor"],
  ["⌘↵", "Save (in editor) · Approve (elsewhere)"],
  ["[ / ]", "Previous / next page"],
];

/** The `?` shortcuts popover (§5.5) — every binding in the keyboard map
 * (§5.9) discoverable, not just muscle-memory. */
export function ShortcutsPopover() {
  const controller = useReviewControllerContext();

  return (
    <Popover onOpenChange={controller.setShortcutsOpen} open={controller.shortcutsOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-keyshortcuts="?"
            aria-label="Keyboard shortcuts"
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <CircleHelp />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <ul className="space-y-1.5">
          {SHORTCUTS.map(([keys, label]) => (
            <li className="flex items-center justify-between gap-3 text-sm" key={keys}>
              <span className="text-muted-foreground">{label}</span>
              <CommandShortcut className="ml-0">{keys}</CommandShortcut>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
