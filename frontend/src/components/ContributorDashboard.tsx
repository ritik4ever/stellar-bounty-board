import React from 'react';
import { useWallet } from '../hooks/useWallet';
import RecommendedBounties from './RecommendedBounties';
import BountyHistory from './BountyHistory';
import WalletInfo from './WalletInfo';

const ContributorDashboard: React.FC = () => {
  const { walletAddress, isConnected } = useWallet();

  return (
    <div className="contributor-dashboard">
      <h2>Contributor Dashboard</h2>
      <WalletInfo />
      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <RecommendedBounties />
        </div>
        <div className="dashboard-panel">
          <BountyHistory />
        </div>
      </div>
    </div>
  );
};

export default ContributorDashboard;
