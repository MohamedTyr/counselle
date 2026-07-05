// Counselle single-column sidebar (desktop).
// Collapsed → a slim icon rail (CollapsedRail). Expanded → one cohesive column:
// header (collapse toggle + New chat), the conversation list, and the account footer.
// No permanent icon rail beside the list anymore.
import { memo } from 'react';
import CollapsedRail, { SidebarColumn } from './ExpandedPanel';
import { cn } from '~/utils';

function ResizeHandle({
  expanded,
  width,
  minWidth,
  maxWidth,
  onResizeStart,
  onResizeKeyboard,
}: {
  expanded: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onResizeKeyboard: (direction: 'shrink' | 'grow') => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      tabIndex={expanded ? 0 : -1}
      className={cn(
        'absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-border-medium active:bg-border-heavy',
        expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ transition: expanded ? 'opacity 200ms ease 80ms' : 'opacity 150ms ease' }}
      onMouseDown={onResizeStart}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          onResizeKeyboard('shrink');
        } else if (e.key === 'ArrowRight') {
          onResizeKeyboard('grow');
        }
      }}
    />
  );
}

function Sidebar({
  expanded,
  width,
  minWidth,
  maxWidth,
  onCollapse,
  onExpand,
  onResizeStart,
  onResizeKeyboard,
}: {
  expanded: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onCollapse: () => void;
  onExpand: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onResizeKeyboard: (direction: 'shrink' | 'grow') => void;
}) {
  if (!expanded) {
    return <CollapsedRail onExpand={onExpand} />;
  }

  return (
    <>
      <SidebarColumn onCollapse={onCollapse} />
      <ResizeHandle
        expanded={expanded}
        width={width}
        minWidth={minWidth}
        maxWidth={maxWidth}
        onResizeStart={onResizeStart}
        onResizeKeyboard={onResizeKeyboard}
      />
    </>
  );
}

export default memo(Sidebar);
