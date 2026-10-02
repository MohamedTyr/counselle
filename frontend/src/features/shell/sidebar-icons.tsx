import type { SVGProps } from "react";

/* `strokeWidth` is fixed per icon, so a caller's spread must not widen it. */
type IconProps = Omit<SVGProps<SVGSVGElement>, "strokeWidth">;

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

/** The rail's collapse control: a panel outline with a divider rule. */
export function PanelToggleIcon(props: IconProps) {
  return (
    <RailIcon size={16} strokeLinecap="round" strokeWidth={1.8} {...props}>
      <rect height="16" rx="3" width="18" x="3" y="4" />
      <line x1="9" x2="9" y1="4" y2="20" />
    </RailIcon>
  );
}
