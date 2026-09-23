import { useEffect, useState } from 'react';

interface Stats {
  totalBounties: number;
  xlmLocked: number;
  openCount: number;
}

export default function StatsBanner() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setStats(data);
      } catch (e) {
        setError((e as Error).message);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="bg-red-100 text-red-800 p-2 text-sm">
        Stats error: {error}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-gray-100 text-gray-800 p-2 text-sm">
        Loading stats...
      </div>
    );
  }

  return (
    <div className="bg-blue-100 text-blue-800 p-4 flex flex-wrap justify-between gap-4 text-sm">
      <span>
        <strong>Total Bounties:</strong> {stats.totalBounties}
      </span>
      <span>
        <strong>XLM Locked:</strong> {stats.xlmLocked.toFixed(2)}
      </span>
      <span>
        <strong>Open Bounties:</strong> {stats.openCount}
      </span>
    </div>
  );
}
