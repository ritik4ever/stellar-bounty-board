/**
 * Skeleton placeholder that mirrors the dimensions of a real bounty-card.
 * Rendered while the initial bounty list is loading to prevent layout shift
 * and provide a smoother first render.
 */
function SkeletonBountyCard() {
  return (
    <article className="bounty-card skeleton-card" aria-hidden="true">
      <div className="bounty-card__top">
        <div>
          <span className="skeleton-block skeleton-pill" />
          <div className="skeleton-block skeleton-title" />
        </div>
        <span className="skeleton-block skeleton-amount" />
      </div>

      <div className="skeleton-block skeleton-text" />
      <div className="skeleton-block skeleton-text skeleton-text--short" />

      <div className="meta-grid">
        <div>
          <span className="skeleton-block skeleton-meta-label" />
          <span className="skeleton-block skeleton-meta-value" />
        </div>
        <div>
          <span className="skeleton-block skeleton-meta-label" />
          <span className="skeleton-block skeleton-meta-value" />
        </div>
        <div>
          <span className="skeleton-block skeleton-meta-label" />
          <span className="skeleton-block skeleton-meta-value" />
        </div>
        <div>
          <span className="skeleton-block skeleton-meta-label" />
          <span className="skeleton-block skeleton-meta-value" />
        </div>
      </div>

      <div className="chip-row">
        <span className="skeleton-block skeleton-chip" />
        <span className="skeleton-block skeleton-chip" />
      </div>

      <div className="action-row">
        <span className="skeleton-block skeleton-button" />
        <span className="skeleton-block skeleton-button skeleton-button--small" />
      </div>
    </article>
  );
}

export default SkeletonBountyCard;
