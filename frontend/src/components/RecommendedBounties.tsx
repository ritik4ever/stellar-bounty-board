import React, { useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getRecommendedBounties } from '../lib/recommendations';
import BountyCard from './BountyCard';
import type { Bounty } from '../types';

const RecommendedBounties: React.FC = () => {
  const { walletAddress, isConnected } = useWallet();
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecommendations = async () => {
      setLoading(true);
      try {
        const recommended = await getRecommendedBounties(walletAddress);
        setBounties(recommended.slice(0, 3));
      } catch (error) {
        console.error('Failed to fetch recommended bounties:', error);
        setBounties([]);
      } finally {
        setLoading(false);
      }
    };

    if (isConnected && walletAddress) {
      fetchRecommendations();
    } else {
      setBounties([]);
      setLoading(false);
    }
  }, [walletAddress, isConnected]);

  if (!isConnected) {
    return (
      <div className="recommended-bounties empty-state">
        <h3>Recommended Bounties</h3>
        <p>Connect your wallet to see personalized bounty recommendations.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="recommended-bounties loading">
        <h3>Recommended Bounties</h3>
        <div className="spinner" />
      </div>
    );
  }

  if (bounties.length === 0) {
    return (
      <div className="recommended-bounties empty-state">
        <h3>Recommended Bounties</h3>
        <p>No recommendations available at this time.</p>
      </div>
    );
  }

  return (
    <div className="recommended-bounties">
      <h3>Recommended Bounties</h3>
      <div className="bounty-list">
        {bounties.map((bounty) => (
          <BountyCard key={bounty.id} bounty={bounty} />
        ))}
      </div>
    </div>
  );
};

export default RecommendedBounties;
