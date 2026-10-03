export function ManagementLoading({ message }: { readonly message: string }) {
  return (
    <section className="management-loading workspace-skeleton" aria-live="polite">
      <p className="muted" role="status">{message}</p>
      <div className="management-loading-summary" aria-hidden="true" aria-busy="true">
        {[0, 1, 2, 3].map((item) => (
          <div className="card card-pad" key={item}>
            <span className="skeleton-line management-skeleton-label" />
            <span className="skeleton-line management-skeleton-value" />
          </div>
        ))}
      </div>
      <div className="management-loading-list" aria-hidden="true" aria-busy="true">
        {[0, 1].map((item) => (
          <div className="card card-pad stack" key={item}>
            <span className="skeleton-line management-skeleton-title" />
            <span className="skeleton-line" />
            <span className="skeleton-block management-skeleton-body" />
          </div>
        ))}
      </div>
    </section>
  );
}
