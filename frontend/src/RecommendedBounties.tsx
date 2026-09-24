import React, { useEffect, useState } from 'react';
import { getRecommendedBounties } from './api/bounties';
import { useNavigate } from 'react-router-dom';
import BountyCard from './BountyCard';

export default function RecommendedBounties() {
  const [bounties, setBounties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getRecommendedBounties()
      .then((data) => setBounties(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div>Loading recommended bounties...</div>;
  }

  if (error) {
    return <div>Error loading recommended bounties: {error}</div>;
  }

  if (bounties.length === 0) {
    return <div>No recommended bounties at the moment.</div>;
  }

  return (
    <ul role="list" className="space-y-4">
      {bounties.map((bounty) => (
        <li key={bounty.id} data-testid={`bounty-card-${bounty.id}`}>
          <BountyCard bounty={bounty} onView={() => navigate(`/bounty/${bounty.id}`)} />
        </li>
      ))}
    </ul>
  );
}
