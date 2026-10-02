// The workspace's one side-panel shell: a docked `<aside>` at `lg` and up, a
// bottom `Sheet` below it. The task detail panel and the calendar's day panel
// both render through it, so the two can never drift in width, inset, motion
// or breakpoint.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-desktop";
import { cn } from "@/lib/utils";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** design doc §7.1 — the aside's own exit duration; entry rides the default
 * 200ms transition below. Keeps the aside mounted for the exit so the
 * `translate`/`opacity` transition can play instead of the panel vanishing
 * mid-slide. */
const EXIT_MS = 150;

/**
 * Two-phase presence for the docked aside, which is a plain `<aside>` and so
 * has no built-in presence management the way the mobile `Sheet` does.
 *
 * `mounted` keeps the element in the tree across the exit so the transition
 * can play. `entered` is what the enter transition needs: the element must
 * first paint at its *from* state (`translate-x-4 opacity-0`) and only then
 * flip to its *to* state, or the browser has nothing to interpolate from and
 * the panel simply appears. That is why `entered` is set from an effect after
 * a frame rather than adjusted during render — a render-phase flip lands both
 * states in the same paint and animates nothing.
 */
function useDelayedUnmount(open: boolean): {
  mounted: boolean;
  entered: boolean;
} {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);

  // Mounting on open has to happen before paint — the element must already
  // be in the tree, at its from-state, for the enter transition to have
  // something to interpolate from. Unmounting is deferred to the effect
  // below so the exit transition can play out first.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMounted(true);
    } else {
      setEntered(false);
    }
  }

  useEffect(() => {
    if (!open) {
      const timeout = window.setTimeout(
        () => setMounted(false),
        prefersReducedMotion() ? 0 : EXIT_MS,
      );
      return () => window.clearTimeout(timeout);
    }

    // One frame at the from-state, then transition to the to-state.
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // An open panel is always mounted. Opening a task from a row used to leave
  // the aside unmounted: the closed state's unmount timer could still land
  // after the open, and nothing ever mounted it again.
  return { mounted: mounted || open, entered };
}

/**
 * The aside is not modal, so opening it leaves focus where it was. Closing it
 * hands focus back to whatever had it at open time when focus was inside the
 * panel (its Close button) or has fallen to `<body>` (the panel unmounted).
 */
function useReturnFocus(
  open: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
) {
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    return () => {
      const opener = openerRef.current;
      const active = document.activeElement;
      const lost =
        !active || active === document.body || Boolean(panel?.contains(active));
      if (lost && opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open, panelRef]);
}

export function DockedPanel({
  children,
  label,
  onOpenChange,
  open,
  title,
}: {
  children: ReactNode;
  /** The aside's accessible name. */
  label: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** The sheet's (visually hidden) title below `lg`. */
  title: string;
}) {
  const isDesktop = useIsDesktop();
  // Only the aside needs manual delayed-unmount: it's a plain element with a
  // hand-rolled transition, not a dialog. The mobile `Sheet` (Base UI) owns
  // its own presence/exit animation once `open` goes false — wrapping it in
  // this too would cut that animation off early instead of complementing it.
  const { mounted, entered } = useDelayedUnmount(open);
  const panelRef = useRef<HTMLElement>(null);
  useReturnFocus(open && isDesktop, panelRef);

  if (!isDesktop) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetPopup
          className="max-h-[85dvh] rounded-t-2xl p-6"
          showCloseButton={false}
          side="bottom"
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          {children}
        </SheetPopup>
      </Sheet>
    );
  }

  if (!mounted) {
    return null;
  }

  return (
    <aside
      aria-label={label}
      data-docked-panel=""
      ref={panelRef}
      className={cn(
        "fixed inset-y-2 end-2 z-[var(--z-sticky)] hidden w-[var(--task-panel-width)] flex-col rounded-2xl border border-[var(--hairline)] bg-[var(--surface-raised)] p-6 shadow-[var(--elevation-2)] lg:flex",
        "transition-[opacity,translate] ease-out motion-reduce:transition-[opacity]",
        entered
          ? "translate-x-0 opacity-100 duration-200"
          : "translate-x-4 opacity-0 duration-150",
      )}
    >
      {children}
    </aside>
  );
}
