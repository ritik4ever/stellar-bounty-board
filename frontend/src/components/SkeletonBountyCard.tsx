import React from 'react';

const SkeletonBountyCard: React.FC = () => {
  return (
    <div className="skeleton-bounty-card" aria-hidden="true">
      <div className="skeleton-header">
        <div className="skeleton-avatar skeleton-pulse" />
        <div className="skeleton-title skeleton-pulse" />
      </div>
      <div className="skeleton-body">
        <div className="skeleton-description skeleton-pulse" />
        <div className="skeleton-description skeleton-pulse skeleton-short" />
      </div>
      <div className="skeleton-footer">
        <div className="skeleton-tag skeleton-pulse" />
        <div className="skeleton-tag skeleton-pulse" />
        <div className="skeleton-amount skeleton-pulse" />
      </div>
    </div>
  );
};

export default SkeletonBountyCard;
