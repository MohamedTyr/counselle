/**
 * The analytics dialog — shell, tab strip, footer drawer, and the reset /
 * import / export flow (plan §5.2; ui-spec §5; parity A1, A11-A19).
 *
 * Below `md:` the shell is a full-bleed `Sheet`, not a capped `Dialog`
 * (ui-spec §5's "Below `md:` a full-bleed `Sheet variant='full'`"); both
 * render the same header/tabs/body/footer content so there is one place
 * that owns the analytics logic.
 */
import { ChartColumn, ChevronDown, Download, Upload } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { satProgressExportUrl } from "@/api/sat/client";
import { useImportProgress, useResetProgress, useSatCounts, useSatStats } from "@/api/sat/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ErrorCard } from "@/components/ui/error-card";
import { Sheet, SheetContent, SheetHeader, SheetPanel, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { profileEmptySheetClass } from "@/features/profile/profile-control-styles";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { SatAnalyticsBands } from "@/features/sat/SatAnalyticsBands";
import { SatAnalyticsDomains } from "@/features/sat/SatAnalyticsDomains";
import { SatAnalyticsOverview } from "@/features/sat/SatAnalyticsOverview";
import { SatAnalyticsPace } from "@/features/sat/SatAnalyticsPace";
import { SatAnalyticsRadar } from "@/features/sat/SatAnalyticsRadar";
import { SatImportConfirmDialog } from "@/features/sat/SatAnalyticsImportDialog";
import { SatResetConfirmDialog } from "@/features/sat/SatAnalyticsResetDialog";

const FOOTER_INSET_CLASS = "pl-4 pr-[calc(1rem+var(--sat-gutter,0px))] sm:pl-6 sm:pr-[calc(1.5rem+var(--sat-gutter,0px))]";

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
  const tabStripRef = useRef<HTMLDivElement>(null);

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

  const stats = statsQuery.data;
  const hasAnyAttempts = (stats?.totalAttemptsCount ?? 0) > 0;

  // On a narrow screen the strip scrolls; keep the current tab in view. The
  // strip only exists once stats have loaded, and a portaled shell mounts a
  // frame after `open` flips, so the scroll waits a frame.
  useEffect(() => {
    if (!open || !hasAnyAttempts) return;
    const frame = requestAnimationFrame(() => {
      tabStripRef.current
        ?.querySelector("[data-active]")
        ?.scrollIntoView?.({ block: "nearest", inline: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, open, hasAnyAttempts]);

  // The body reserves a scrollbar gutter so tabs of different heights don't
  // shift the layout; the footer pads by the same width so its right edge
  // lines up with the sheets above it.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  useEffect(() => {
    if (!bodyEl) return;
    const measure = () => setScrollbarWidth(bodyEl.offsetWidth - bodyEl.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bodyEl);
    return () => observer.disconnect();
  }, [bodyEl]);

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

  const header = (
    <div className="flex flex-col gap-3">
      <span className="pr-10 text-base font-semibold tracking-tight">{SAT_ANALYTICS_COPY.title}</span>
      {hasAnyAttempts && (
        <div ref={tabStripRef} className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [&::-webkit-scrollbar]:hidden">
          <Tabs onValueChange={(value) => onTabChange(value as SatAnalyticsTab)} value={tab}>
            <TabsList variant="pill">
              {SAT_ANALYTICS_TABS.map((t) => (
                <TabsTab key={t} value={t}>
                  {SAT_ANALYTICS_COPY.tabs[t]}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
    </div>
  );

  const body = (
    <div
      className="@container/sat-analytics flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--canvas)] p-4 [scrollbar-gutter:stable] sm:p-6"
      data-slot="sat-analytics-body"
      ref={setBodyEl}
    >
      {statsQuery.isError ? (
        <ErrorCard
          message={SAT_ANALYTICS_COPY.loadFailed.description}
          onRetry={() => statsQuery.refetch()}
          retryLabel={SAT_ANALYTICS_COPY.loadFailed.retry}
          title={SAT_ANALYTICS_COPY.loadFailed.title}
        />
      ) : statsQuery.isLoading || !stats ? (
        <div aria-busy="true" className="flex flex-col gap-8">
          <Skeleton className="h-52 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-8 @[760px]/sat-analytics:grid-cols-2">
            <Skeleton className="h-52 w-full rounded-xl" />
            <Skeleton className="h-52 w-full rounded-xl" />
          </div>
        </div>
      ) : !hasAnyAttempts ? (
        <Empty className={cn(profileEmptySheetClass, "my-auto flex-none")}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumn />
            </EmptyMedia>
            <EmptyTitle>{SAT_ANALYTICS_COPY.empty.title}</EmptyTitle>
            <EmptyDescription>{SAT_ANALYTICS_COPY.empty.description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => onOpenChange(false)}>{SAT_ANALYTICS_COPY.empty.action}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div key={instanceKey}>
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
    <div
      className="border-t border-[var(--hairline)] bg-[var(--surface-raised)]"
      data-slot="sat-analytics-footer"
      style={{ "--sat-gutter": `${scrollbarWidth}px` } as React.CSSProperties}
    >
      <div className={cn("flex items-center justify-end gap-3 py-2.5", FOOTER_INSET_CLASS)}>
        <Button
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
          size="sm"
          variant="ghost"
        >
          {SAT_ANALYTICS_COPY.footer.dataAndProgress}
          <ChevronDown
            className={cn(
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              drawerOpen && "rotate-180",
            )}
          />
        </Button>
      </div>
      {drawerOpen && (
        <div
          className={cn(
            "grid grid-cols-2 gap-2 border-t border-[var(--hairline)] py-3 sm:flex sm:items-center",
            FOOTER_INSET_CLASS,
          )}
        >
          <Button
            render={
              <a
                download={`${todayKey}.liprep`}
                href={satProgressExportUrl(todayKey)}
                onClick={handleExportClick}
              />
            }
            size="sm"
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
          <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline">
            <Upload />
            {SAT_ANALYTICS_COPY.footer.importProgress}
          </Button>
          <Button
            className="col-span-2 sm:ml-auto"
            onClick={handleResetPress}
            size="sm"
            variant="destructive-outline"
          >
            {SAT_ANALYTICS_COPY.reset.pressSequence[resetPresses]}
          </Button>
        </div>
      )}
    </div>
  ) : null;

  const shell = isMobile ? (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent initialFocus={false} variant="full">
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
      <DialogContent
        className="flex h-[min(860px,92dvh)] max-w-[min(1080px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden rounded-2xl bg-[var(--surface-raised)] p-0 shadow-[var(--elevation-3)] sm:max-w-[min(1080px,calc(100vw-2rem))]"
        onOpenAutoFocus={(event) => {
          // Land on the panel, not on the close button: a focus ring on ✕
          // the moment the dialog opens reads as a pending action.
          event.preventDefault();
          (event.target as HTMLElement).focus();
        }}
      >
        <DialogHeader className="border-b border-[var(--hairline)] px-6 pt-5 pb-4">
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
      <SatResetConfirmDialog
        isPending={resetMutation.isPending}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={handleConfirmReset}
        onOpenChange={(next) => !resetMutation.isPending && setResetConfirmOpen(next)}
        open={resetConfirmOpen}
        totalAttempts={stats?.totalAttemptsCount ?? 0}
        totalBookmarks={totalBookmarks}
      />
      <SatImportConfirmDialog
        fileName={pendingImportFile?.name ?? ""}
        isPending={importMutation.isPending}
        onCancel={handleCancelImport}
        onConfirm={handleConfirmImport}
        onOpenChange={(next) => !next && handleCancelImport()}
        open={pendingImportFile !== null}
        totalAttempts={stats?.totalAttemptsCount ?? 0}
        totalBookmarks={totalBookmarks}
      />
    </>
  );
}
