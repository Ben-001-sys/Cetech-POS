export type ManagementLoadingVariant =
  | "system-health"
  | "staff"
  | "topology"
  | "policy"
  | "audit"
  | "shifts"
  | "returns"
  | "receipt";

export function ManagementLoading({
  message,
  variant,
  showCreate = false,
}: {
  readonly message: string;
  readonly variant: ManagementLoadingVariant;
  readonly showCreate?: boolean;
}) {
  return (
    <section className="management-loading workspace-skeleton" aria-live="polite" data-management-loading={variant}>
      <p className="muted" role="status">{message}</p>
      <div aria-hidden="true" aria-busy="true">
        <LoadingLayout variant={variant} showCreate={showCreate} />
      </div>
    </section>
  );
}

function LoadingLayout({ variant, showCreate }: {
  readonly variant: ManagementLoadingVariant;
  readonly showCreate: boolean;
}) {
  switch (variant) {
    case "system-health":
      return (
        <div className="system-health-panel stack">
          <div className="banner management-skeleton-banner"><Line short /><Line /></div>
          <div className="system-health-list">
            {[0, 1, 2].map((item) => (
              <article className="card card-pad stack system-health-card" key={item}>
                <CardHead className="system-health-head" />
                <Line />
                <Line short />
                <Line short />
              </article>
            ))}
          </div>
          <Line short />
        </div>
      );
    case "staff":
      return (
        <div className="management-staff-list">
          {showCreate ? <CreateCard /> : null}
          {[0, 1].map((item) => (
            <section className="card card-pad stack management-staff-card" key={item}>
              <CardHead className="management-staff-head" />
              <div className="management-meta-grid"><Field /><Field /></div>
              <Line short />
              <Field />
              <Field />
            </section>
          ))}
        </div>
      );
    case "topology":
      return (
        <div className="stack">
          {showCreate ? <CreateCard /> : null}
          <div className="management-grid">
            {[0, 1].map((item) => (
              <section className="card card-pad stack" key={item}>
                <CardHead className="management-staff-head" />
                <Line short />
                <Field />
                <Field />
              </section>
            ))}
          </div>
        </div>
      );
    case "policy":
      return (
        <div className="stack">
          <Field />
          <section className="card card-pad stack management-policy">
            <CardHead className="management-policy-head" />
            {[0, 1, 2, 3, 4].map((item) => (
              <div className="management-policy-row" key={item}>
                <div className="management-skeleton-copy stack"><Line short /><Line /></div>
                <span className="skeleton-block management-skeleton-toggle" />
              </div>
            ))}
            <Field />
            <Line short />
            <Field />
          </section>
        </div>
      );
    case "audit":
      return (
        <div className="management-audit-panel stack">
          <Line />
          <div className="management-audit-list">
            {[0, 1].map((item) => (
              <article className="card card-pad stack management-audit-card" key={item}>
                <CardHead className="management-audit-head" />
                <div className="management-audit-facts"><Field /><Field /><Field /></div>
                <Line short />
                <Line />
              </article>
            ))}
          </div>
        </div>
      );
    case "shifts":
    case "returns": {
      const prefix = variant === "shifts" ? "shift-cash" : "returns-attention";
      return (
        <div className={`${prefix}-panel stack`}>
          <Line />
          <ul className={`${prefix}-summary`}>
            {[0, 1, 2, 3].map((item) => (
              <li className={`${prefix}-stat`} key={item}>
                <Line />
                <span className="skeleton-line management-skeleton-value" />
              </li>
            ))}
          </ul>
          {[0, 1].map((item) => (
            <div className="stack" key={item}>
              <Line short />
              <div className={`${prefix}-list`}>
                <article className={`card card-pad ${prefix}-card`}>
                  <div className={`${prefix}-card-main`}>
                    <div className="stack"><CardHead className={variant === "shifts" ? "management-staff-head" : "returns-attention-head"} /><Line /><Line /></div>
                    <div className="stack"><Field /><Field /></div>
                    {variant === "shifts" ? <div className="stack"><Line /><Line /></div> : null}
                  </div>
                </article>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "receipt":
      return (
        <div className="receipt-settings-panel stack">
          <Field />
          <section className="card card-pad stack receipt-settings-editor">
            <CardHead className="receipt-settings-head" />
            <div className="receipt-settings-grid">
              <div className="receipt-settings-fields stack">
                {[0, 1, 2, 3, 4, 5].map((item) => <Field key={item} />)}
              </div>
              <section className="receipt-settings-preview stack">
                <Line short />
                <Line />
                <Field />
                <div className="receipt-settings-preview-paper">
                  <span className="skeleton-block management-skeleton-receipt" />
                </div>
              </section>
            </div>
          </section>
        </div>
      );
  }
}

function Line({ short = false }: { readonly short?: boolean }) {
  return <span className={short ? "skeleton-line management-skeleton-label" : "skeleton-line"} />;
}

function Field() {
  return <div className="stack"><Line short /><span className="skeleton-block management-skeleton-field" /></div>;
}

function CardHead({ className }: { readonly className: string }) {
  return (
    <div className={className}>
      <div className="stack"><span className="skeleton-line management-skeleton-title" /><Line /></div>
      <span className="skeleton-line management-skeleton-pill" />
    </div>
  );
}

function CreateCard() {
  return (
    <section className="card card-pad stack management-topology-create">
      <span className="skeleton-line management-skeleton-title" />
      <Field />
      <Field />
    </section>
  );
}
