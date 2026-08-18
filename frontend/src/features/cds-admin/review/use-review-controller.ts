import { useEffect, useMemo, useRef, useState } from "react";

import type { ReviewMetric, ReviewSection } from "@/api/cds-admin/types";
import type { ReviewController } from "@/features/cds-admin/review/review-context";
import type { PdfPageViewerHandle } from "@/features/cds-admin/review/PdfPageViewer";
import {
  buildFlagQueue,
  sectionsWithUnresolvedFlags,
  sortMetricsFlaggedFirst,
} from "@/features/cds-admin/review/flag-queue";

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
  );
}

function buildMetricIndex(sections: readonly ReviewSection[]) {
  const byRef = new Map<string, { metric: ReviewMetric; domainId: string }>();
  for (const section of sections) {
    for (const metric of section.metrics) {
      byRef.set(metric.ref, { metric, domainId: section.domain_id });
    }
  }
  return byRef;
}

/**
 * The flag-queue / row-nav / focus-management controller behind DESIGN.md
 * §5.1 and §5.9's keyboard map. One instance per document, provided via
 * `ReviewControllerContext`.
 *
 * Two-step focus (§1.11): `focusMetric` opens the target's section if it's
 * collapsed and defers the actual DOM focus to an effect keyed on
 * `pendingFocusRef` — the accordion panel has to mount first.
 */
export function useReviewController(params: {
  sections: readonly ReviewSection[];
  flaggedFirst: boolean;
  viewerRef: React.RefObject<PdfPageViewerHandle | null>;
  currentPage: number;
  onApprove: () => void;
  announce: (message: string) => void;
}): ReviewController {
  const { sections, flaggedFirst, viewerRef, currentPage, onApprove, announce } =
    params;

  const [openDomains, setOpenDomainsState] = useState<Set<string>>(
    () => new Set(sectionsWithUnresolvedFlags(sections)),
  );
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [focusedRef, setFocusedRef] = useState<string | null>(null);
  const [pendingFocusRef, setPendingFocusRef] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const refs = useRef(new Map<string, HTMLElement>());

  const byRef = useMemo(() => buildMetricIndex(sections), [sections]);
  const flagQueue = useMemo(
    () => buildFlagQueue(sections, flaggedFirst),
    [sections, flaggedFirst],
  );
  const visibleMetrics = useMemo(() => {
    const ordered: { metric: ReviewMetric; domainId: string }[] = [];
    for (const section of sections) {
      if (!openDomains.has(section.domain_id)) continue;
      for (const metric of sortMetricsFlaggedFirst(section.metrics, flaggedFirst)) {
        ordered.push({ metric, domainId: section.domain_id });
      }
    }
    return ordered;
  }, [sections, openDomains, flaggedFirst]);

  function jumpEvidence(page: number | null | undefined) {
    if (page == null) return;
    viewerRef.current?.goToPage(page, { flash: true });
    announce(`Showing page ${page}`);
  }

  function focusMetric(ref: string) {
    const entry = byRef.get(ref);
    if (!entry) return;
    if (!openDomains.has(entry.domainId)) {
      setOpenDomainsState((current) => new Set(current).add(entry.domainId));
      setPendingFocusRef(ref);
      return;
    }
    const el = refs.current.get(ref);
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  }

  useEffect(() => {
    if (!pendingFocusRef) return;
    const entry = byRef.get(pendingFocusRef);
    if (!entry || !openDomains.has(entry.domainId)) return;
    const el = refs.current.get(pendingFocusRef);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus();
    setPendingFocusRef(null);
  }, [pendingFocusRef, openDomains, byRef]);

  function goToFlagBy(step: 1 | -1) {
    if (flagQueue.length === 0) return;
    const currentIndex = flagQueue.findIndex((m) => m.ref === focusedRef);
    const nextIndex =
      currentIndex === -1
        ? step === 1
          ? 0
          : flagQueue.length - 1
        : (currentIndex + step + flagQueue.length) % flagQueue.length;
    const target = flagQueue[nextIndex];
    focusMetric(target.ref);
    jumpEvidence(target.evidence?.page_number);
  }

  function goToRowBy(step: 1 | -1) {
    if (visibleMetrics.length === 0) return;
    const currentIndex = visibleMetrics.findIndex(
      (entry) => entry.metric.ref === focusedRef,
    );
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + step + visibleMetrics.length) % visibleMetrics.length;
    focusMetric(visibleMetrics[nextIndex].metric.ref);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      const isSubmit = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      if (isSubmit) {
        event.preventDefault();
        onApprove();
        return;
      }
      switch (event.key) {
        case "n":
          event.preventDefault();
          goToFlagBy(1);
          break;
        case "p":
          event.preventDefault();
          goToFlagBy(-1);
          break;
        case "j":
          event.preventDefault();
          goToRowBy(1);
          break;
        case "k":
          event.preventDefault();
          goToRowBy(-1);
          break;
        case "e":
        case "Enter":
          if (focusedRef) {
            event.preventDefault();
            setEditingRef(focusedRef);
          }
          break;
        case "[":
          event.preventDefault();
          viewerRef.current?.goToPage(currentPage - 1);
          break;
        case "]":
          event.preventDefault();
          viewerRef.current?.goToPage(currentPage + 1);
          break;
        case "?":
          event.preventDefault();
          setShortcutsOpen((open) => !open);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return {
    openDomains,
    setOpenDomains: (domains) => setOpenDomainsState(new Set(domains)),
    editingRef,
    setEditingRef,
    registerMetricRef: (ref, el) => {
      if (el) refs.current.set(ref, el);
      else refs.current.delete(ref);
    },
    reportFocus: setFocusedRef,
    focusMetric,
    jumpEvidence,
    goToNextFlag: () => goToFlagBy(1),
    goToPrevFlag: () => goToFlagBy(-1),
    flaggedFirst,
    shortcutsOpen,
    setShortcutsOpen,
  };
}
