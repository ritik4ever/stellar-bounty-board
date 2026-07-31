import { useEffect, useMemo, useState } from 'react';

import { listBounties } from './api';
import RecommendedBounties from './RecommendedBounties';
import {
  createDefaultProfile,
  generateRecommendations,
  updateProfileFromBounties,
} from './recommendations';
import { useWallet } from './hooks';
import type { Bounty } from './types';
import { getContributorMetrics } from './utils';

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

interface ContributorDashboardProps {
  bounties?: Bounty[];
  loading?: boolean;
}

export default function ContributorDashboard({
  bounties: bountiesProp,
  loading: loadingProp,
}: ContributorDashboardProps) {
  const { address, isConnected, connect, disconnect } = useWallet();
  const [fetchedBounties, setFetchedBounties] = useState<Bounty[]>([]);
  const [fetchLoading, setFetchLoading] = useState(bountiesProp === undefined);

  useEffect(() => {
    if (bountiesProp !== undefined) {
      return;
    }

    let active = true;
    setFetchLoading(true);

    void listBounties()
      .then((data) => {
        if (active) {
          setFetchedBounties(data);
        }
      })
      .catch(() => {
        if (active) {
          setFetchedBounties([]);
        }
      })
      .finally(() => {
        if (active) {
          setFetchLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [bountiesProp]);

  const bounties = bountiesProp ?? fetchedBounties;
  const loading = loadingProp ?? fetchLoading;

  const recommendations = useMemo(() => {
    if (!address) {
      return [];
    }

    const contributorBounties = bounties.filter((bounty) => bounty.contributor === address);
    const profile = updateProfileFromBounties(createDefaultProfile(), contributorBounties);
    profile.address = address;

    return generateRecommendations(bounties, profile, 3);
  }, [address, bounties]);

  const metrics = useMemo(
    () => getContributorMetrics(bounties, address ?? undefined),
    [address, bounties]
  );

  const releasedTotal = useMemo(() => {
    return [...metrics.releasedTotalsByAsset.entries()]
      .map(([asset, total]) => `${total} ${asset}`)
      .join(', ');
  }, [metrics.releasedTotalsByAsset]);

  return (
    <div className="contributor-dashboard">
      <header className="contributor-dashboard__header">
        <div>
          <span className="panel-kicker">Contributor dashboard</span>
          <h2>Your bounty workspace</h2>
          <p className="panel-description">
            Personalized recommendations based on labels from your completed work.
          </p>
        </div>
        <div className="contributor-dashboard__wallet">
          {isConnected && address ? (
            <>
              <span className="wallet-chip">{shortAddress(address)}</span>
              <button type="button" className="ghost-button" onClick={disconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" className="connect-wallet-btn" onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {isConnected && (
        <section className="metrics contributor-dashboard__metrics" aria-label="Contributor metrics">
          <div>
            <span className="meta-label">Released earnings</span>
            <strong>{releasedTotal || '0'}</strong>
          </div>
          <div>
            <span className="meta-label">Completed</span>
            <strong>{metrics.countsByStatus.get('released') ?? 0}</strong>
          </div>
          <div>
            <span className="meta-label">Active reservations</span>
            <strong>{metrics.countsByStatus.get('reserved') ?? 0}</strong>
          </div>
        </section>
      )}

      <RecommendedBounties
        recommendations={recommendations}
        loading={loading && isConnected}
        walletConnected={isConnected}
      />
    </div>
  );
}
