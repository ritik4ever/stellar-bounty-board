import SkeletonBountyCard from "./SkeletonBountyCard";

export const BOUNTY_CARD_SKELETON_COUNT = 6;

type BountyListLoadingProps = {
  count?: number;
};

export default function BountyListLoading({ count = BOUNTY_CARD_SKELETON_COUNT }: BountyListLoadingProps) {
  return (
    <div
      className="bounty-grid"
      aria-busy="true"
      aria-live="polite"
      data-testid="bounty-list-loading"
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBountyCard key={`bounty-skeleton-${index}`} />
      ))}
    </div>
  );
}