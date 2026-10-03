"use client";

import type { ReactNode } from "react";
import { AppToast, type AppToastView } from "../toast";
import { PrimaryNav } from "./PrimaryNav";
import { type PosRoute } from "./routes";
import { TopBar, type TopBarProps } from "./TopBar";

export type AppShellProps = TopBarProps & {
  activeRoute: PosRoute;
  attentionCount?: number;
  onNavigate?: (route: PosRoute) => void;
  liveMessage?: string;
  toast?: AppToastView | null;
  children: ReactNode;
};

export function AppShell({
  activeRoute,
  attentionCount = 0,
  onNavigate,
  liveMessage,
  toast,
  children,
  ...topBar
}: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="live-region" aria-live="polite">
        {liveMessage ?? ""}
      </div>
      <aside className="sidebar" aria-label="App sidebar">
        <div className="brand-mark" title="CETECH">
          CT
        </div>
        <PrimaryNav
          activeRoute={activeRoute}
          attentionCount={attentionCount}
          onNavigate={onNavigate}
          includeSettings
        />
      </aside>
      <div className="app-main">
        <TopBar {...topBar} attentionCount={attentionCount} onOpenAttention={() => onNavigate?.("attention")} />
        {toast ? <AppToast title={toast.title} detail={toast.detail} /> : null}
        <main className="content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
