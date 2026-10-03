"use client";

export type AppToastView = {
  readonly title: string;
  readonly detail?: string;
};

export function AppToast({
  title,
  detail,
  open = true,
}: AppToastView & { readonly open?: boolean }) {
  if (!open) {
    return null;
  }
  return (
    <div className="app-toast" role="status" aria-live="polite" aria-atomic="true" data-app-toast="true">
      <svg className="app-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 7h.01" />
      </svg>
      <div className="app-toast-copy">
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  );
}
