/**
 * The analytics dialog — shell, tab strip, footer drawer, and the reset /
 * import / export flow (plan §5.2; ui-spec §5; parity A1, A11-A19).
 *
 * Below `md:` the shell is a full-bleed `Sheet`, not a capped `Dialog`
 * (ui-spec §5's "Below `md:` a full-bleed `Sheet variant='full'`"); both
 * render the same header/tabs/body/footer content so there is one place
 * that owns the analytics logic.
 */
import {
  ChartColumn,
  ChartNoAxesColumn,
  ChevronDown,
  Download,
  LayoutDashboard,
  List,
  Radar as RadarIcon,
  Timer,
  Upload,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DismissableLayer } from "radix-ui/internal";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { satProgressExportUrl } from "@/api/sat/client";
import { useImportProgress, useResetProgress, useSatCounts, useSatStats } from "@/api/sat/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ErrorCard } from "@/components/ui/error-card";
import { Sheet, SheetContent, SheetHeader, SheetPanel, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-copy";
import { SatAnalyticsBands } from "@/features/sat/SatAnalyticsBands";
import { SatAnalyticsDomains } from "@/features/sat/SatAnalyticsDomains";
import { SatAnalyticsOverview } from "@/features/sat/SatAnalyticsOverview";
import { SatAnalyticsPace } from "@/features/sat/SatAnalyticsPace";
import { SatAnalyticsRadar } from "@/features/sat/SatAnalyticsRadar";

/**
 * The reset/import confirms render through `DialogPortal`, which (like every
 * Radix portal) always teleports to `document.body` regardless of where it
 * sits in the React tree — so simply nesting the confirm's JSX inside the
 * shell's own `DialogContent` would NOT make it a DOM descendant of the
 * shell, and wouldn't fix anything on its own. What makes Radix treat a
 * portaled dialog as "part of" an outer one is `DismissableLayer.Branch`: a
 * plain marker div, registered into Radix's (module-global) dismissable-layer
 * context, that any outside-interaction check (`onPointerDownOutside`,
 * `onFocusOutside`) treats as "inside" for every currently-mounted Radix
 * dismissable layer — including the shell's. This local variant wraps the
 * *whole* `DialogPrimitive.Content` (children + close button — the shared
 * `DialogContent`'s ✕ is a sibling of `{children}`, so a wrapper around just
 * `{children}` wouldn't contain it) in one `Branch`, mirroring
 * `DialogContent`'s own markup/classes, since `DialogContent` doesn't expose
 * a way to inject a wrapper around itself.
 *
 * That branch check alone is not sufficient, though: Radix's own
 * `usePointerDownOutside` defers a click's outside-check to the browser's
 * *next* `click` event so text selection isn't misread as a dismiss. Cancel
 * (or ✕) both (a) flips this dialog's own `open` to `false` and (b) fires a
 * *native* click that keeps bubbling to `document` — and because this
 * dialog's `Presence`-driven exit here runs with no detected CSS animation
 * (`getComputedStyle(...).animationName === "none"`, which is what a
 * reduced-motion / low-power browser reports), (a) unmounts this dialog,
 * *including its Branch's cleanup effect*, synchronously, in the same tick,
 * before that native click reaches `document`. So by the time the shell's
 * deferred check runs, the branch that would have exempted it is already
 * gone — Branch fixes this whenever the exit is actually animated, but not
 * reliably. `stopPropagation()` on Cancel/✕'s own click (below) is what
 * makes this deterministic instead of animation-timing-dependent: it keeps
 * the native click from ever reaching `document`, so Radix's own
 * interception bookkeeping (`wasOutsideInteractionIntercepted`, keyed off
 * whether the click's document-level listener actually fired) reports it as
 * intercepted and the shell's outside-check is never dispatched at all.
 */
function ConfirmDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>): React.ReactElement {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DismissableLayer.Branch className="contents">
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "fixed top-1/2 left-1/2 z-[var(--z-modal)] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-[var(--edge)] duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
          <DialogClose data-slot="dialog-close" asChild>
            <Button
              className="absolute top-2 right-2"
              onClick={(event) => event.stopPropagation()}
              size="icon-sm"
              variant="ghost"
            >
              <X />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </DialogPrimitive.Content>
      </DismissableLayer.Branch>
    </DialogPortal>
  );
}

export type SatAnalyticsTab = "overview" | "radar" | "pace" | "bands" | "domains";

export const SAT_ANALYTICS_TABS: readonly SatAnalyticsTab[] = [
  "overview",
  "radar",
  "pace",
  "bands",
  "domains",
];

export function isSatAnalyticsTab(value: string | null): value is SatAnalyticsTab {
  return value !== null && (SAT_ANALYTICS_TABS as readonly string[]).includes(value);
}

const TAB_ICON: Record<SatAnalyticsTab, React.ComponentType<{ className?: string }>> = {
  bands: ChartNoAxesColumn,
  domains: List,
  overview: LayoutDashboard,
  pace: Timer,
  radar: RadarIcon,
};

export interface SatAnalyticsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SatAnalyticsTab;
  onTabChange: (tab: SatAnalyticsTab) => void;
  todayKey: string;
  /** Built by the caller from the dashboard's *current* filter selection —
   * never the launched filter — so a drill inherits it without ever
   * touching the saved topic selection (plan §5.3, A6). */
  onDrill: (skillCode: string) => void;
}

export function SatAnalytics({
  open,
  onOpenChange,
  tab,
  onTabChange,
  todayKey,
  onDrill,
}: SatAnalyticsProps): React.ReactElement {
  const isMobile = useIsMobile();
  const statsQuery = useSatStats(todayKey);
  // No dedicated bookmark-count endpoint exists (plan §4.6 never added
  // one) — `/counts` already answers "how many questions match this
  // filter", and `status: "bookmarked"` with every other filter opened up
  // is exactly "how many bookmarks exist", summed across skills.
  const bookmarksQuery = useSatCounts({
    bands: [],
    excludeBluebook: false,
    status: "bookmarked",
  });
  const totalBookmarks = bookmarksQuery.data
    ? Object.values(bookmarksQuery.data).reduce((sum, n) => sum + n, 0)
    : 0;

  const [instanceKey, setInstanceKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resetPresses, setResetPresses] = useState(0);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useImportProgress();
  const resetMutation = useResetProgress();

  // A19: every open resets tab-local state — the drawer, the reset
  // counter, any picked-but-unconfirmed import file, and (via the body's
  // `key={instanceKey}`) each tab's own search box / segmented selection.
  useEffect(() => {
    if (open) {
      setInstanceKey((k) => k + 1);
      setDrawerOpen(false);
      setResetPresses(0);
      setResetConfirmOpen(false);
      setPendingImportFile(null);
    }
  }, [open]);

  const busy = resetMutation.isPending || importMutation.isPending;
  // `ConfirmDialogContent`'s `DismissableLayer.Branch` makes Radix's own
  // outside-interaction detection on the desktop shell correctly ignore the
  // confirms. The mobile shell is a Base UI Sheet, which listens for Escape
  // independently of Radix's layering (no shared branch concept), so this
  // guard — plus the confirms' own `stopPropagation` below — is still what
  // keeps the Sheet open on that layout. It also blocks the shell from
  // closing while a mutation is in flight (`busy`, checked below).
  const confirmOpen = resetConfirmOpen || pendingImportFile !== null;

  function handleOpenChange(next: boolean) {
    if (busy && !next) return;
    if (confirmOpen && !next) return;
    onOpenChange(next);
  }

  function handleResetPress() {
    if (resetPresses >= 2) {
      setResetPresses(0);
      setResetConfirmOpen(true);
      return;
    }
    setResetPresses((n) => n + 1);
  }

  function handleConfirmReset() {
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        setResetConfirmOpen(false);
        onOpenChange(false);
      },
    });
  }

  function handleFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (file) {
      setPendingImportFile(file);
    }
  }

  function handleCancelImport() {
    setPendingImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleConfirmImport() {
    if (!pendingImportFile) return;
    importMutation.mutate(
      { file: pendingImportFile, today: todayKey },
      {
        onSettled: () => {
          setPendingImportFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
        onSuccess: (result) => {
          // Unlike reset, a successful import does not close the panel: the
          // student just replaced their progress and should see it reflected
          // here, not be dropped back to the dashboard. `useImportProgress`'s
          // own `onSettled` already invalidates `satKeys.all`, so every tab
          // refetches the imported data before this toast is even read.
          toast.success(
            SAT_ANALYTICS_COPY.footer.importedToast(
              result.attempts_imported,
              result.bookmarks_imported,
            ),
          );
        },
      },
    );
  }

  // A12: the export is a plain `<a download>` — the page never observes
  // completion, so the toast fires on click, not on a response.
  function handleExportClick() {
    toast.success(SAT_ANALYTICS_COPY.footer.exportingToast(`${todayKey}.liprep`));
  }

  const stats = statsQuery.data;
  const hasAnyAttempts = (stats?.totalAttemptsCount ?? 0) > 0;

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ChartColumn className="size-5 text-[var(--ink-secondary)]" />
        <span className="font-heading text-lg font-medium">{SAT_ANALYTICS_COPY.title}</span>
      </div>
      <div className="overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]">
        <Tabs onValueChange={(value) => onTabChange(value as SatAnalyticsTab)} value={tab}>
          <TabsList>
            {SAT_ANALYTICS_TABS.map((t) => {
              const Icon = TAB_ICON[t];
              return (
                <TabsTab key={t} value={t}>
                  <Icon />
                  {SAT_ANALYTICS_COPY.tabs[t]}
                </TabsTab>
              );
            })}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );

  const body = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6" data-slot="sat-analytics-body">
      {statsQuery.isError ? (
        <ErrorCard
          message={SAT_ANALYTICS_COPY.loadFailed.description}
          onRetry={() => statsQuery.refetch()}
          retryLabel={SAT_ANALYTICS_COPY.loadFailed.retry}
          title={SAT_ANALYTICS_COPY.loadFailed.title}
        />
      ) : statsQuery.isLoading || !stats ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 @[768px]/sat-analytics:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton className="h-28 w-full rounded-xl" key={i} />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : !hasAnyAttempts ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{SAT_ANALYTICS_COPY.empty.title}</EmptyTitle>
            <EmptyDescription>{SAT_ANALYTICS_COPY.empty.description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => onOpenChange(false)}>{SAT_ANALYTICS_COPY.empty.action}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="@container/sat-analytics" key={instanceKey}>
          {tab === "overview" && <SatAnalyticsOverview onDrill={onDrill} stats={stats} />}
          {tab === "radar" && <SatAnalyticsRadar stats={stats} />}
          {tab === "pace" && <SatAnalyticsPace stats={stats} />}
          {tab === "bands" && <SatAnalyticsBands stats={stats} />}
          {tab === "domains" && <SatAnalyticsDomains onDrill={onDrill} stats={stats} />}
        </div>
      )}
    </div>
  );

  const footer = stats ? (
    <div className="border-t" data-slot="sat-analytics-footer">
      <button
        aria-expanded={drawerOpen}
        className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left hover:bg-accent"
        onClick={() => setDrawerOpen((v) => !v)}
        type="button"
      >
        <span className="text-sm text-[var(--ink-secondary)]">
          {SAT_ANALYTICS_COPY.footer.summary(stats.totalAttemptsCount, stats.avgTimeSeconds)}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {SAT_ANALYTICS_COPY.footer.dataAndProgress}
          <ChevronDown className={cn("size-4 transition-transform", drawerOpen && "rotate-180")} />
        </span>
      </button>
      {drawerOpen && (
        <div className="flex flex-col gap-2 px-6 pb-4 sm:flex-row">
          <Button
            render={
              <a
                download={`${todayKey}.liprep`}
                href={satProgressExportUrl(todayKey)}
                onClick={handleExportClick}
              />
            }
            variant="outline"
          >
            <Download />
            {SAT_ANALYTICS_COPY.footer.exportProgress}
          </Button>
          <input
            accept=".liprep,.json"
            className="hidden"
            onChange={handleFilePicked}
            ref={fileInputRef}
            type="file"
          />
          <Button onClick={() => fileInputRef.current?.click()} variant="outline">
            <Upload />
            {SAT_ANALYTICS_COPY.footer.importProgress}
          </Button>
          <Button onClick={handleResetPress} variant="destructive-outline">
            {SAT_ANALYTICS_COPY.reset.pressSequence[resetPresses]}
          </Button>
        </div>
      )}
    </div>
  ) : null;

  const shell = isMobile ? (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent variant="full">
        <SheetHeader>
          <SheetTitle className="sr-only">{SAT_ANALYTICS_COPY.title}</SheetTitle>
          {header}
        </SheetHeader>
        <SheetPanel className="flex min-h-0 flex-1 flex-col p-0">{body}</SheetPanel>
        {footer}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex h-[min(900px,92dvh)] max-w-[1160px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1160px]">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle className="sr-only">{SAT_ANALYTICS_COPY.title}</DialogTitle>
          {header}
        </DialogHeader>
        {body}
        {footer}
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      {shell}
      <Dialog onOpenChange={(next) => !resetMutation.isPending && setResetConfirmOpen(next)} open={resetConfirmOpen}>
        <ConfirmDialogContent
          onEscapeKeyDown={(event) => {
            if (resetMutation.isPending) {
              event.preventDefault();
              return;
            }
            // `DismissableLayer.Branch` (see `ConfirmDialogContent`) makes
            // the shell correctly ignore this dialog's own outside
            // interactions, but Escape is still a raw document keydown for
            // the mobile Sheet (Base UI listens independently of Radix's
            // dismissal layering) — stop it from also reaching the shell's
            // own Escape handling there.
            event.stopPropagation();
          }}
          onPointerDownOutside={(event) => {
            if (resetMutation.isPending) {
              event.preventDefault();
              return;
            }
            event.stopPropagation();
          }}
          role="alertdialog"
        >
          <DialogHeader>
            <DialogTitle>{SAT_ANALYTICS_COPY.reset.confirm.title}</DialogTitle>
            <DialogDescription>
              {SAT_ANALYTICS_COPY.reset.confirm.description(
                stats?.totalAttemptsCount ?? 0,
                totalBookmarks,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={resetMutation.isPending}
              onClick={(event) => {
                event.stopPropagation();
                setResetConfirmOpen(false);
              }}
              variant="outline"
            >
              {SAT_ANALYTICS_COPY.reset.confirm.cancel}
            </Button>
            <Button loading={resetMutation.isPending} onClick={handleConfirmReset} variant="destructive">
              {SAT_ANALYTICS_COPY.reset.confirm.confirm}
            </Button>
          </DialogFooter>
        </ConfirmDialogContent>
      </Dialog>
      <Dialog onOpenChange={(next) => !next && handleCancelImport()} open={pendingImportFile !== null}>
        <ConfirmDialogContent
          onEscapeKeyDown={(event) => {
            if (importMutation.isPending) {
              event.preventDefault();
              return;
            }
            // See the reset confirm above — still needed for the mobile
            // Sheet's independent Escape handling.
            event.stopPropagation();
          }}
          onPointerDownOutside={(event) => {
            if (importMutation.isPending) {
              event.preventDefault();
              return;
            }
            event.stopPropagation();
          }}
          role="alertdialog"
        >
          <DialogHeader>
            <DialogTitle>{SAT_ANALYTICS_COPY.footer.importConfirm.title}</DialogTitle>
            <DialogDescription>
              {SAT_ANALYTICS_COPY.footer.importConfirm.description(
                stats?.totalAttemptsCount ?? 0,
                totalBookmarks,
                pendingImportFile?.name ?? "",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={importMutation.isPending}
              onClick={(event) => {
                event.stopPropagation();
                handleCancelImport();
              }}
              variant="outline"
            >
              {SAT_ANALYTICS_COPY.footer.importConfirm.cancel}
            </Button>
            <Button loading={importMutation.isPending} onClick={handleConfirmImport}>
              {SAT_ANALYTICS_COPY.footer.importConfirm.confirm}
            </Button>
          </DialogFooter>
        </ConfirmDialogContent>
      </Dialog>
    </>
  );
}
