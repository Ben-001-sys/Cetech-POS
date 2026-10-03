"use client";

export type TopBarProps = {
  registerName?: string;
  cashierDisplayName?: string;
  shiftOpen?: boolean;
  online?: boolean;
  updateReady?: boolean;
  attentionCount?: number;
  onLock?: () => void;
  onOpenUpdate?: () => void;
  onOpenManagement?: () => void;
  onOpenAttention?: () => void;
};

export function TopBar({
  registerName = "No register",
  cashierDisplayName,
  shiftOpen = false,
  online = true,
  updateReady = false,
  attentionCount = 0,
  onLock,
  onOpenUpdate,
  onOpenManagement,
  onOpenAttention,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="app-title">CETECH POS</span>
        <span className="context-pill" title={registerName}>{registerName}</span>
        {cashierDisplayName ? <span className="context-pill secondary" title={cashierDisplayName}>{cashierDisplayName}</span> : null}
        {shiftOpen ? (
          <span className="status-pill success shift-status" aria-label="Shift open">
            <span className="dot" aria-hidden="true" />
            <span className="status-text">Shift open</span>
          </span>
        ) : (
          <span className="status-pill warning shift-status" aria-label="No open shift">
            <span className="dot" aria-hidden="true" />
            <span className="status-text">No open shift</span>
          </span>
        )}
      </div>
      <div className="topbar-right">
        {attentionCount > 0 ? (
          <button className="btn mobile-attention" type="button" onClick={onOpenAttention} aria-label={`Needs attention ${attentionCount}`}>
            Needs attention <span className="attention-count">{attentionCount}</span>
          </button>
        ) : null}
        <span
          className={online ? "status-pill success" : "status-pill warning"}
          data-online={online ? "true" : "false"}
          aria-label={online ? "Online" : "Offline"}
        >
          <span className="dot" aria-hidden="true" />
          <span className="status-text">{online ? "Online" : "Offline"}</span>
        </span>
        {onOpenManagement ? (
          <button className="btn small" type="button" onClick={onOpenManagement}>
            Manage
          </button>
        ) : null}
        {updateReady ? (
          <button className="btn small" type="button" onClick={onOpenUpdate}>
            Update ready
          </button>
        ) : null}
        <button className="icon-btn" type="button" onClick={onLock} title="Lock register" aria-label="Lock register">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
          </svg>
        </button>
      </div>
    </header>
  );
}
