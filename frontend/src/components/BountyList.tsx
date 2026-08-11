import React, { useState, useEffect } from 'react';
import BountyCard from './BountyCard';
import SkeletonBountyCard from './SkeletonBountyCard';
import { fetchBounties } from '../services/api';
import type { Bounty } from '../types';

const BountyList: React.FC = () => {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBounties = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBounties();
      setBounties(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bounties');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBounties();
  }, []);

  if (loading) {
    return (
      <div className="bounty-list-skeleton" aria-busy="true" role="status" aria-label="Loading bounties">
        <div className="bounty-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonBountyCard key={`skeleton-${index}`} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bounty-list-error" role="alert">
        <p>Error: {error}</p>
        <button onClick={loadBounties} className="retry-button">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bounty-list" role="list" aria-label="Bounties">
      <div className="bounty-grid">
        {bounties.map((bounty) => (
          <BountyCard key={bounty.id} bounty={bounty} />
        ))}
      </div>
    </div>
  );
};

export default BountyList;
