import { SearchX } from "lucide-react";

type Props = {
  /** Bold heading line, e.g. "No open bounties" */
  heading: string;
  /** Supporting sentence shown below the heading */
  message: string;
  /** When true the "Clear filters" CTA is rendered */
  hasFilters: boolean;
  /** Called when the user clicks "Clear filters" */
  onClearFilters: () => void;
};

/**
 * Shown in the bounty board when the filtered result list is empty.
 * The parent is responsible for deriving the heading/message from active
 * filter state so this component stays purely presentational and testable.
 */
export default function EmptyState({ heading, message, hasFilters, onClearFilters }: Props) {
  return (
    <div className="empty-state empty-state--board" role="status" aria-live="polite">
      <SearchX className="empty-state__icon" aria-hidden="true" size={40} />
      <h3 className="empty-state__heading">{heading}</h3>
      <p className="empty-state__message">{message}</p>
      {hasFilters && (
        <button
          type="button"
          className="secondary-button empty-state__cta"
          onClick={onClearFilters}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
