import React from "react";

export interface EmptyStateProps {
  /** Current search query (debounced) */
  searchQuery?: string;
  /** Current status filter */
  statusFilter?: string;
  /** Minimum reward filter */
  minReward?: string;
  /** Maximum reward filter */
  maxReward?: string;
  /** Repository filter */
  repoFilter?: string;
  /** Callback to reset all active filters */
  onClearFilters?: () => void;
}

/**
 * Renders a contextual empty state when the filtered bounty list returns zero results.
 *
 * The message varies by active filter so users understand why the board is blank.
 * When filters are active, a "Clear filters" button resets them to see all bounties.
 */
export default function EmptyState({
  searchQuery,
  statusFilter,
  minReward,
  maxReward,
  repoFilter,
  onClearFilters,
}: EmptyStateProps) {
  const hasFilters = Boolean(
    searchQuery ||
      (statusFilter && statusFilter !== "all") ||
      minReward ||
      maxReward ||
      repoFilter,
  );

  const message = (() => {
    if (searchQuery) {
      return (
        <>
          No bounties match "<strong>{searchQuery}</strong>"
        </>
      );
    }
    if (statusFilter && statusFilter !== "all") {
      return <>No {statusFilter} bounties</>;
    }
    if (minReward || maxReward) {
      return <>No XLM bounties in this reward range</>;
    }
    if (repoFilter) {
      return <>No bounties in {repoFilter}</>;
    }
    return <>No bounties available yet</>;
  })();

  return (
    <div className="empty-state">
      <div className="empty-state__content">
        <h3>No bounties found</h3>
        <p>{message}</p>
        {hasFilters && onClearFilters && (
          <button
            type="button"
            className="secondary-button"
            onClick={onClearFilters}
            style={{ marginTop: 16 }}
          >
            Clear filters
          </button>
        )}
        <div className="empty-state__suggestions">
          <p>
            <strong>Suggestions:</strong>
          </p>
          <ul>
            {hasFilters ? (
              <>
                <li>Try adjusting your search terms or filters</li>
                <li>Check back later for new bounties</li>
                <li>Browse all repositories to see available opportunities</li>
              </>
            ) : (
              <>
                <li>Check back later for new bounties</li>
                <li>Create the first bounty to get started</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
