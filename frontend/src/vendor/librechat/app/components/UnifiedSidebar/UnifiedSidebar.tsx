// Vendored from upstream client/src/components/UnifiedSidebar/UnifiedSidebar.tsx @ 197a1dc4
// Subtractions: SidebarChatProvider (ChatContext/ChatFormProvider/useChatHelpers),
//   useUnifiedSidebarLinks replaced with single conversations link,
//   SidePanelNav replaced with direct ConversationsSection, localize nav close.
// Rewire: sidebarExpanded Recoil → jotai sidebarExpandedAtom.
import { useCallback, useState, useEffect, useRef, memo, startTransition } from 'react';
import { useAtom } from 'jotai';
import { useMediaQuery } from '@librechat/client';
import { ActivePanelProvider } from '~/Providers/ActivePanelContext';
import Sidebar from './Sidebar';
import { SidebarColumn } from './ExpandedPanel';
import { sidebarExpandedAtom } from '@/app/state';
import { cn } from '~/utils';

const COLLAPSED_WIDTH = 52;
const EXPANDED_MIN = 360;
const TRANSITION_MS = 300;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

function getInitialWidth(): number {
  const saved = localStorage.getItem('side:width');
  return saved ? Math.max(Number(saved), EXPANDED_MIN) : EXPANDED_MIN;
}

function UnifiedSidebar() {
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [expanded, setExpanded] = useAtom(sidebarExpandedAtom);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandlers = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const handleCollapse = useCallback(() => {
    startTransition(() => {
      setExpanded(false);
    });
  }, [setExpanded]);

  const handleExpand = useCallback(() => {
    startTransition(() => {
      setExpanded(true);
    });
  }, [setExpanded]);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.style.userSelect = 'none';
    const maxWidth = window.innerWidth * 0.4;
    let rafId: number | null = null;

    const move = (e: MouseEvent) => {
      if (rafId != null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const next = Math.max(EXPANDED_MIN, Math.min(e.clientX, maxWidth));
        setSidebarWidth(next);
      });
    };

    const up = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      document.body.style.userSelect = '';
      setIsResizing(false);
      resizeHandlers.current = null;
      setSidebarWidth((w) => {
        localStorage.setItem('side:width', String(Math.round(w)));
        return w;
      });
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };

    resizeHandlers.current = { move, up };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  const handleResizeKeyboard = useCallback((direction: 'shrink' | 'grow') => {
    setSidebarWidth((w) => {
      const next =
        direction === 'shrink'
          ? Math.max(w - 20, EXPANDED_MIN)
          : Math.min(w + 20, window.innerWidth * 0.4);
      localStorage.setItem('side:width', String(Math.round(next)));
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (resizeHandlers.current) {
        document.removeEventListener('mousemove', resizeHandlers.current.move);
        document.removeEventListener('mouseup', resizeHandlers.current.up);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSmallScreen || !expanded) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCollapse();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSmallScreen, expanded, handleCollapse]);

  if (isSmallScreen) {
    return (
      <>
        <div
          className={cn(
            'fixed left-0 top-0 z-[110] flex h-full bg-surface-primary-alt',
            expanded ? 'translate-x-0' : '-translate-x-full',
          )}
          style={{
            width: 'min(85vw, 380px)',
            transition: `transform ${TRANSITION_MS}ms ${EASING}`,
          }}
          inert={!expanded ? '' : undefined}
        >
          <ActivePanelProvider>
            <SidebarColumn onCollapse={handleCollapse} />
          </ActivePanelProvider>
        </div>
        <div
          className={cn(
            'fixed inset-0 z-[109] bg-black/50',
            expanded ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transition: `opacity ${TRANSITION_MS}ms ${EASING}` }}
          role="presentation"
        >
          <button
            className="h-full w-full"
            onClick={handleCollapse}
            aria-label="Close sidebar"
            tabIndex={expanded ? 0 : -1}
          />
        </div>
      </>
    );
  }

  return (
    <ActivePanelProvider>
      <aside
        className="relative flex h-full flex-shrink-0 overflow-hidden"
        style={{
          width: expanded ? sidebarWidth : COLLAPSED_WIDTH,
          minWidth: expanded ? EXPANDED_MIN : COLLAPSED_WIDTH,
          maxWidth: expanded ? '40%' : COLLAPSED_WIDTH,
          transition: isResizing
            ? 'none'
            : `width ${TRANSITION_MS}ms ${EASING}, min-width ${TRANSITION_MS}ms ${EASING}, max-width ${TRANSITION_MS}ms ${EASING}`,
        }}
        aria-label="Control panel"
      >
        <Sidebar
          expanded={expanded}
          width={sidebarWidth}
          minWidth={EXPANDED_MIN}
          maxWidth={Math.round(window.innerWidth * 0.4)}
          onCollapse={handleCollapse}
          onExpand={handleExpand}
          onResizeStart={handleResizeStart}
          onResizeKeyboard={handleResizeKeyboard}
        />
      </aside>
    </ActivePanelProvider>
  );
}

export default memo(UnifiedSidebar);
