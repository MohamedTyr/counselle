import type { SVGProps } from "react";

/*
 * The rail's icon set, transcribed path-for-path from variant 1a of the
 * Sidebar Redesign design doc.
 *
 * These replace the lucide icons the nav used to import. Lucide is drawn on
 * a 24px grid at stroke 2 with a uniform geometric hand; 1a's set is drawn
 * on the same grid at stroke 1.7-1.9 with visibly softer, more specific
 * shapes — a mortarboard with a tassel rather than lucide's `School`
 * building, a hand-weighted four-point sparkle rather than `Bot`. Swapping
 * the token colours onto lucide glyphs got the rail's palette right and its
 * drawing wrong, which is most of what "not exact" looks like at this size.
 *
 * Stroke width and viewport size are per-icon in the doc and are kept that
 * way: the nav glyphs sit at 17px/1.7, the two action glyphs (plus, panel)
 * at 16px/1.8-1.9, the filter glyph at 15px/1.8. They are not normalised to
 * one pair — the doc's optical sizing is part of what is being matched, and
 * a 17px sparkle next to a 16px plus is deliberate.
 *
 * Consumers size these with a `size-*` class rather than the width/height
 * attributes, because SidebarMenuButton ships a `[&_svg]:size-4` rule that
 * would otherwise win over the attributes. The attributes stay as the
 * fallback for any consumer that doesn't set a class.
 */

type IconProps = SVGProps<SVGSVGElement>;

function RailIcon({
  size,
  strokeWidth,
  ...props
}: IconProps & { size: number; strokeWidth: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    />
  );
}

/* --- nav glyphs: 17px, stroke 1.7 --- */

export function AiIcon(props: IconProps) {
  return (
    <RailIcon size={17} strokeLinejoin="round" strokeWidth={1.7} {...props}>
      <path d="M12 3 C12.6 7.8 16.2 11.4 21 12 C16.2 12.6 12.6 16.2 12 21 C11.4 16.2 7.8 12.6 3 12 C7.8 11.4 11.4 7.8 12 3 Z" />
    </RailIcon>
  );
}

export function SchoolsIcon(props: IconProps) {
  return (
    <RailIcon
      size={17}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      {...props}
    >
      <path d="M2.8 9.4 L12 5 L21.2 9.4 L12 13.8 Z" />
      <path d="M6.8 11.3 V15.7 c0 1.5 2.3 2.6 5.2 2.6 s5.2-1.1 5.2-2.6 V11.3" />
      <line x1="21.2" x2="21.2" y1="9.4" y2="13.6" />
    </RailIcon>
  );
}

export function EssaysIcon(props: IconProps) {
  return (
    <RailIcon
      size={17}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      {...props}
    >
      <rect height="18" rx="2.5" width="14" x="5" y="3" />
      <line x1="9" x2="15" y1="9" y2="9" />
      <line x1="9" x2="15" y1="13" y2="13" />
      <line x1="9" x2="12" y1="17" y2="17" />
    </RailIcon>
  );
}

export function ActivitiesIcon(props: IconProps) {
  return (
    <RailIcon
      size={17}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      {...props}
    >
      <polyline points="3 8 5 10 8 6" />
      <polyline points="3 17 5 19 8 15" />
      <line x1="12" x2="21" y1="8" y2="8" />
      <line x1="12" x2="21" y1="17" y2="17" />
    </RailIcon>
  );
}

export function TasksIcon(props: IconProps) {
  return (
    <RailIcon
      size={17}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      {...props}
    >
      <rect height="16" rx="3" width="16" x="4" y="4" />
      <polyline points="8.5 12 11 14.5 15.5 9.5" />
    </RailIcon>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <RailIcon size={17} strokeLinecap="round" strokeWidth={1.7} {...props}>
      <rect height="15" rx="3" width="16" x="4" y="5" />
      <line x1="4" x2="20" y1="10" y2="10" />
      <line x1="9" x2="9" y1="3" y2="6" />
      <line x1="15" x2="15" y1="3" y2="6" />
    </RailIcon>
  );
}

export function ProfileIcon(props: IconProps) {
  return (
    <RailIcon size={17} strokeLinecap="round" strokeWidth={1.7} {...props}>
      <circle cx="12" cy="9" r="3.2" />
      <path d="M5.5 19.5c1.3-3 3.7-4.5 6.5-4.5s5.2 1.5 6.5 4.5" />
    </RailIcon>
  );
}

/* --- action glyphs --- */

/** The "New chat" glyph. 1a draws a plain plus, not a compose/pencil mark. */
export function NewChatIcon(props: IconProps) {
  return (
    <RailIcon size={16} strokeLinecap="round" strokeWidth={1.9} {...props}>
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </RailIcon>
  );
}

/** The rail's collapse control: a panel outline with a divider rule. */
export function PanelToggleIcon(props: IconProps) {
  return (
    <RailIcon size={16} strokeLinecap="round" strokeWidth={1.8} {...props}>
      <rect height="16" rx="3" width="18" x="3" y="4" />
      <line x1="9" x2="9" y1="4" y2="20" />
    </RailIcon>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <RailIcon size={15} strokeLinecap="round" strokeWidth={1.8} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="16" x2="20" y1="16" y2="20" />
    </RailIcon>
  );
}
