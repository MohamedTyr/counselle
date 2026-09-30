import type { CSSProperties } from "react";
import { NavLink } from "react-router";

import type { ShellRoute } from "@/app/shell/navigation";
import { useSidebar } from "@/components/ui/sidebar";

type MainNavProps = {
  routes: ShellRoute[];
};

/** The sidebar's destination list: a coloured icon tile and a label per
 * route. NavLink sets `aria-current="page"` on the current one, which is
 * what the stylesheet keys the selected state from. */
export function MainNav({ routes }: MainNavProps) {
  const { setOpenMobile } = useSidebar();

  return (
    <nav aria-label="Main navigation" className="as-nav">
      {routes.map((route) => (
        <NavLink
          className="as-nav-row"
          end={route.link === "/app/tasks"}
          key={route.id}
          onClick={() => setOpenMobile(false)}
          style={
            {
              "--as-tile": route.tile,
              "--as-tile-active": route.tileActive,
            } as CSSProperties
          }
          to={route.link}
        >
          <span aria-hidden="true" className="as-tile">
            {route.icon}
          </span>
          <span>{route.title}</span>
        </NavLink>
      ))}
    </nav>
  );
}
