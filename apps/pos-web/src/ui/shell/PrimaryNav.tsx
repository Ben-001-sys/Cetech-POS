"use client";

import { PRIMARY_NAV_ITEMS, POS_ROUTE_HREFS, SETTINGS_NAV_ITEM, type PosRoute } from "./routes";
import { NavIcon } from "./NavIcon";

export type PrimaryNavProps = {
  activeRoute: PosRoute;
  attentionCount?: number;
  onNavigate?: (route: PosRoute) => void;
  includeSettings?: boolean;
};

function NavButton({
  route,
  label,
  active,
  badge,
  onNavigate,
}: {
  route: PosRoute;
  label: string;
  active: boolean;
  badge?: string;
  onNavigate?: (route: PosRoute) => void;
}) {
  const href = POS_ROUTE_HREFS[route];
  return (
    <button
      type="button"
      className={active ? "nav-btn active" : "nav-btn"}
      aria-current={active ? "page" : undefined}
      aria-label={badge ? `${label} ${badge}` : label}
      data-route={route}
      data-href={href}
      onClick={() => onNavigate?.(route)}
    >
      <span className="icon" aria-hidden="true">
        <NavIcon route={route} />
      </span>
      <span className="nav-label">
        {label}
        {badge ? <span className="nav-badge"> {badge}</span> : null}
      </span>
    </button>
  );
}

export function PrimaryNav({
  activeRoute,
  attentionCount = 0,
  onNavigate,
  includeSettings = false,
}: PrimaryNavProps) {
  const items = includeSettings ? [...PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM] : PRIMARY_NAV_ITEMS;
  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {items.map((item) => (
        <NavButton
          key={item.route}
          route={item.route}
          label={item.label}
          active={activeRoute === item.route}
          badge={item.route === "attention" && attentionCount > 0 ? String(attentionCount) : undefined}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
