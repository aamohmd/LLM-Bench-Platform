type SkeletonStateProps = {
  label: string;
  rows?: number;
  compact?: boolean;
};

export function SettingsSectionSkeleton({ label, rows = 4, compact = false }: SkeletonStateProps) {
  return (
    <div className={`ui-skeleton-state${compact ? " is-compact" : ""}`} role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="ui-skeleton-state__heading skeleton" aria-hidden="true" />
      <div className="ui-skeleton-state__rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="ui-skeleton-state__row" key={index}>
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScoreboardSkeleton({ label = "Loading scoreboard" }: { label?: string }) {
  return (
    <section className="panel scoreboard-skeleton" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="scoreboard-skeleton__header" aria-hidden="true">
        <div>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
        <div className="skeleton scoreboard-skeleton__select" />
      </div>
      <div className="scoreboard-skeleton__filters" aria-hidden="true">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <div className="scoreboard-skeleton__table" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="scoreboard-skeleton__row" key={index}>
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DetailPageSkeleton({ label }: { label: string }) {
  return (
    <main className="visualizer detail-page-skeleton" aria-busy="true" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      <header className="detail-page-skeleton__hero" aria-hidden="true">
        <div>
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
        <span className="skeleton detail-page-skeleton__hero-panel" />
      </header>
      <section className="detail-page-skeleton__metrics" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <span className="skeleton" key={index} />)}
      </section>
      <section className="detail-page-skeleton__content" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </section>
    </main>
  );
}
