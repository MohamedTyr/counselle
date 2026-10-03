// A popover opened from code and pinned to an element, rather than owned by a
// trigger. The calendar has hundreds of chips; one page-level popover that
// re-anchors is lighter than a popover root inside every chip, and it lets a
// keyboard shortcut open the same surface a click does.
import type { ReactNode } from "react";

import { Popover, PopoverPopup } from "@/components/ui/popover";

export function AnchoredPopover({
  align = "start",
  anchor,
  children,
  className,
  label,
  onOpenChange,
  open,
  side = "bottom",
}: {
  align?: "start" | "center" | "end";
  anchor: HTMLElement | null;
  children: ReactNode;
  className?: string;
  label: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Popover onOpenChange={onOpenChange} open={open && Boolean(anchor)}>
      <PopoverPopup
        align={align}
        anchor={anchor}
        aria-label={label}
        className={className}
        // Focus goes back to whatever opened the popover, as it would to a
        // trigger — unless that element has left the page.
        finalFocus={() => (anchor?.isConnected ? anchor : true)}
        side={side}
        sideOffset={6}
      >
        {children}
      </PopoverPopup>
    </Popover>
  );
}
