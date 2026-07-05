// Counselle single-column sidebar controls.
// Originally the vendored two-pane ExpandedPanel (a permanent icon rail beside the
// conversation list). Reworked into composable atoms — SidebarToggle, NewChatButton —
// plus a CollapsedRail (the slim icon strip shown only when the sidebar is collapsed).
// The expanded state is now a single column assembled in Sidebar.tsx, so there is no
// longer a rail sitting next to the list.
import { memo, useCallback, lazy, Suspense } from 'react';
import { SquarePen } from 'lucide-react';
import { Skeleton, Sidebar as SidebarIcon, Button, TooltipAnchor } from '@librechat/client';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import { useChatContext } from '@/app/ChatContext';
import ConversationsSection from './ConversationsSection';

const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));

/** The collapse / expand control. Reused in the collapsed rail and the expanded header. */
export const SidebarToggle = memo(function SidebarToggle({
  expanded,
  onToggle,
  tooltipSide = 'right',
}: {
  expanded: boolean;
  onToggle?: () => void;
  tooltipSide?: 'right' | 'bottom';
}) {
  const localize = useLocalize();
  const label = expanded ? 'com_nav_close_sidebar' : 'com_nav_open_sidebar';
  return (
    <TooltipAnchor
      side={tooltipSide}
      description={localize(label)}
      render={
        <Button
          id={expanded ? CLOSE_SIDEBAR_ID : undefined}
          data-testid={expanded ? 'close-sidebar-button' : 'open-sidebar-button'}
          size="icon"
          variant="ghost"
          aria-label={localize(label)}
          aria-expanded={expanded}
          className="h-9 w-9 flex-shrink-0 rounded-lg text-text-secondary hover:text-text-primary"
          onClick={onToggle}
        >
          <SidebarIcon aria-hidden="true" className="h-5 w-5" />
        </Button>
      }
    />
  );
});

/** New-chat action — a compact icon button (collapsed rail + expanded search row). */
export const NewChatButton = memo(function NewChatButton({
  tooltipSide = 'bottom',
}: {
  tooltipSide?: 'right' | 'bottom';
}) {
  const localize = useLocalize();
  const { newConversation } = useChatContext();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        newConversation();
      }
    },
    [newConversation],
  );

  return (
    <TooltipAnchor
      side={tooltipSide}
      description={localize('com_ui_new_chat')}
      render={
        <a
          href="/"
          data-testid="new-chat-button"
          aria-label={localize('com_ui_new_chat')}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-active-alt hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-xheavy"
          onClick={handleClick}
        >
          <SquarePen className="h-[18px] w-[18px]" aria-hidden="true" />
        </a>
      }
    />
  );
});

/** Expanded-column header: the Counselle wordmark on the left, collapse + new-chat
 *  controls grouped on the right. */
export const SidebarHeader = memo(function SidebarHeader({
  onCollapse,
}: {
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-12 items-center justify-between gap-1 px-3">
      <span className="select-none pl-2 text-xl font-semibold tracking-tight text-text-primary">
        Counselle
      </span>
      <div className="flex items-center gap-1">
        <NewChatButton tooltipSide="bottom" />
        <SidebarToggle expanded onToggle={onCollapse} tooltipSide="bottom" />
      </div>
    </div>
  );
});

/** The slim icon strip shown when the sidebar is collapsed. */
function CollapsedRail({ onExpand }: { onExpand?: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center gap-1 bg-surface-primary-alt px-2 py-3">
      <SidebarToggle expanded={false} onToggle={onExpand} />
      <NewChatButton tooltipSide="right" />
      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
    </div>
  );
}

/** Account row pinned to the bottom of the expanded column. */
export const SidebarFooter = memo(function SidebarFooter({ className }: { className?: string }) {
  return (
    <div className={cn('border-t border-border-light px-3 py-2', className)}>
      <Suspense fallback={<Skeleton className="h-12 w-full rounded-lg" />}>
        <AccountSettings />
      </Suspense>
    </div>
  );
});

/** The full expanded column — header, scrollable conversation list, account footer.
 *  Shared by the desktop aside (Sidebar.tsx) and the mobile drawer (UnifiedSidebar.tsx)
 *  so the two never drift apart. */
export const SidebarColumn = memo(function SidebarColumn({
  onCollapse,
}: {
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-surface-primary-alt">
      <SidebarHeader onCollapse={onCollapse} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ConversationsSection />
      </div>
      <SidebarFooter />
    </div>
  );
});

export default memo(CollapsedRail);
