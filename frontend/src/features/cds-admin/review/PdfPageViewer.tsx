import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { pageImageUrl } from "@/api/cds-admin/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const FLASH_DURATION_MS = 900;
const IMAGE_WIDTH = 1400;

export type PdfPageViewerHandle = {
  goToPage: (page: number, opts?: { flash?: boolean }) => void;
};

type FitMode = "width" | "actual";

/** The left pane (§5.4) — paged PNG images, no PDF.js. Keeps the previous
 * page visible (dimmed) while the next one loads instead of blanking, and
 * prefetches page ±1 so `[`/`]` feel instant against the endpoint's
 * `immutable` cache. `goToPage` is the imperative API the right pane calls
 * on an evidence-chip jump — it never moves focus (§1.11). */
export const PdfPageViewer = forwardRef<
  PdfPageViewerHandle,
  {
    documentId: number;
    /** The document's true page count, or `null` when unknown (a document
     * that didn't come through the upload flow). Falls back to the
     * currently-shown page so the "/ N" toolbar never claims a wrong total —
     * it just grows with navigation instead. */
    pageCount: number | null;
    onPageChange?: (page: number) => void;
    className?: string;
  }
>(function PdfPageViewer(
  { documentId, pageCount, onPageChange, className },
  ref,
) {
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const [fit, setFit] = useState<FitMode>("width");
  const [flashing, setFlashing] = useState(false);
  const reduceMotion = useReducedMotion();
  const flashTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => () => clearTimeout(flashTimeout.current), []);

  function requestPage(target: number, opts?: { flash?: boolean }): number {
    const upperBound = pageCount ?? Infinity;
    const clamped = Math.min(upperBound, Math.max(1, Math.round(target)));
    setPage(clamped);
    setFailed(false);
    onPageChange?.(clamped);
    if (opts?.flash) {
      setFlashing(true);
      clearTimeout(flashTimeout.current);
      flashTimeout.current = setTimeout(
        () => setFlashing(false),
        reduceMotion ? 0 : FLASH_DURATION_MS,
      );
      if (reduceMotion) setFlashing(false);
    }
    return clamped;
  }

  // A commit (blur/Enter) whose target clamps to the already-current page
  // never fires the `[page]` effect above, so the input can be left showing
  // un-clamped text (e.g. typing "999999" on the last page). Force-sync it
  // here regardless of whether `page` actually changed.
  function commitPageInput() {
    setPageInput(String(requestPage(Number(pageInput) || page)));
  }

  // No dependency array: `requestPage` closes over `page`/`onPageChange`/
  // `reduceMotion` and is redefined every render anyway, so the handle
  // must be too — otherwise `goToPage` would call a stale closure.
  useImperativeHandle(ref, () => ({ goToPage: requestPage }));

  const isLoading = loadedPage !== page && !failed;
  const showPage = failed ? page : (loadedPage ?? page);
  const total = pageCount ?? showPage;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
        <Button
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => requestPage(page - 1)}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <Input
          aria-label="Page number"
          className="w-12 text-center text-sm tabular-nums"
          onBlur={commitPageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitPageInput();
          }}
          size="sm"
          value={pageInput}
        />
        <span className="text-sm text-muted-foreground tabular-nums">
          / {Math.max(total, showPage)}
        </span>
        <Button
          aria-label="Next page"
          disabled={pageCount != null && page >= pageCount}
          onClick={() => requestPage(page + 1)}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
        <div className="flex-1" />
        <Select
          items={[
            { label: "Fit width", value: "width" },
            { label: "Actual size", value: "actual" },
          ]}
          onValueChange={(value) => setFit(value as FitMode)}
          value={fit}
        >
          <SelectTrigger aria-label="Zoom" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="width">Fit width</SelectItem>
            <SelectItem value="actual">Actual size</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {failed ? (
          <div className="flex aspect-[8.5/11] w-full max-w-3xl flex-col items-center justify-center gap-3 rounded-lg border text-center">
            <p className="text-sm text-muted-foreground">
              Could not render page {page}.
            </p>
            <Button
              onClick={() => requestPage(page)}
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "mx-auto w-fit rounded-lg outline-none",
              flashing &&
                cn(
                  "ring-2 ring-ring",
                  !reduceMotion && "transition-shadow duration-300",
                ),
            )}
          >
            <img
              alt={`Page ${showPage} of ${Math.max(total, showPage)}`}
              className={cn(
                "rounded-lg border transition-opacity",
                fit === "width" ? "mx-auto w-full max-w-3xl" : "max-w-none",
                isLoading && "opacity-64",
              )}
              key={documentId}
              loading="eager"
              src={pageImageUrl(documentId, showPage, IMAGE_WIDTH)}
            />
          </div>
        )}
        {isLoading && !failed && (
          // Hidden preloader for the target page — swaps `loadedPage` over
          // once it lands, so the visible image above never blanks.
          <img
            alt=""
            className="hidden"
            onError={() => setFailed(true)}
            onLoad={() => setLoadedPage(page)}
            src={pageImageUrl(documentId, page, IMAGE_WIDTH)}
          />
        )}
        {!failed && page > 1 && (
          <img
            alt=""
            className="hidden"
            src={pageImageUrl(documentId, page - 1, IMAGE_WIDTH)}
          />
        )}
        {!failed && (pageCount == null || page < pageCount) && (
          <img
            alt=""
            className="hidden"
            src={pageImageUrl(documentId, page + 1, IMAGE_WIDTH)}
          />
        )}
      </div>
    </div>
  );
});
