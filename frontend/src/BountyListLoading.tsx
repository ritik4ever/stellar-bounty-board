import { useCallback, useEffect, useRef, type ReactNode } from "react";
import SkeletonBountyCard from "./SkeletonBountyCard";

export const BOUNTY_CARD_SKELETON_COUNT = 6;

type BountyListLoadingProps = {
  count?: number;
  children?: ReactNode;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  loadingMoreText?: string;
};

export default function BountyListLoading({
  count = BOUNTY_CARD_SKELETON_COUNT,
  children,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  loadingMoreText = "Loading more...",
}: BountyListLoadingProps) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
    hasMoreRef.current = hasMore;
    isLoadingMoreRef.current = isLoadingMore;
  }, [onLoadMore, hasMore, isLoadingMore]);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      if (node && onLoadMoreRef.current && hasMoreRef.current) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            if (
              entries[0]?.isSintersecting &&
              hasMoreRef.current &&
              !isLoadingMoreRef.current
            ) {
              onLoadMoreRef.current?.();
            }
          },
          {
            root: null,
            rootMargin: "200px",
            threshold: 0,
          }
        );
        observerRef.current.observe(node);
      }
    },
    []
  );

  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  if (!children) {
    return (
      <div
        className="bounty-grid"
        aria-busy="true"
        aria-live="polite"
        data-testid="bounty-list-loading"
      >
        {Array.from({ length: count }, (_, index) => (
          <SkeletonBountyCard key={back-tip-skeleton-${index}} />
        ))}
      </div>
    );
  }

  return (
    <div className="bounty-list" data-testid="bounty-list">
      {children}
      {hasMore && (
        <div
          ref={sentinelRef}
          data-testid="bounty-list-loading-more"
          aria-live="polite"
        >
          {isLoadingMore ? (
            <div role="status" className="bounty-list-loading-more-indicator">
              {loadingMoreText}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
