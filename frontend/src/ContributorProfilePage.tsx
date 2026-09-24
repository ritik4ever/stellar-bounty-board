import React, { useEffect, useMemo, useState } from "react";
import CopyIcon from "./CopyIcons";
import ContributorDashboard from "./ContributorDashboard";
import { listBounties } from "./api";
import type { Bounty } from "./types";

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function fetchContributorBounties(address: string): Promise<Bounty[]> {
  const res = await fetch(`/api/bounties?contributor=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error("Failed to load contributor bounties");
  const body = await res.json();
  return body.data ?? [];
}

async function fetchLeaderboard(): Promise<any[]> {
  const res = await fetch(`/api/leaderboard`);
  if (!res.ok) return [];
  const body = await res.json();
  return body.data ?? [];
}

type Reputation = {
  score: number;
};

type Badge = {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
};

async function fetchReputation(address: string): Promise<Reputation | null> {
  try {
    const res = await fetch(`/api/reputation?contributor=${encodeURIComponent(address)}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.data ?? null;
  } catch (err) {
    return null;
  }
}

async function fetchBadges(address: string): Promise<Badge[]> {
  try {
    const res = await fetch(`/api/badges?contributor=${encodeURIComponent(address)}`);
    if (!res.ok) return [];
    const body = await res.json();
    return body.data ?? [];
  } catch (err) {
    return [];
  }
}

export default function ContributorProfilePage({
  address,
  onBack,
}: {
  address: string;
  onBack?: () => void;
}) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [allBounties, setAllBounties] = useState<Bounty[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loadingReputation, setLoadingReputation] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingReputation(true);

    Promise.all([
      fetchReputation(address),
      fetchBadges(address)
    ]).then(([repData, badgesData]) => {
      if (active) {
        setReputation(repData);
        setBadges(badgesData);
        setLoadingReputation(false);
      }
    });

    void fetchContributorBounties(address)
      .then((data) => {
        if (active) setBounties(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });

    void listBounties()
      .then((data) => {
        if (active) setAllBounties(data);
      })
      .catch(() => {
        if (active) setAllBounties([]);
      });

    void fetchLeaderboard().then((data) => {
      if (active) setLeaderboard(data);
    }).catch(() => {
      // ignore
    });

    return () => {
      active = false;
    };
  }, [address]);

  useEffect(() => {
    const title = `Contributor ${shortAddress(address)} — Stellar Bounty Board`;
    document.title = title;
    const setMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.content = content;
    };
    setMeta("description", `Profile for contributor ${shortAddress(address)} — earned reputation and completed work.`);
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", title);
    setMeta("og:title", title);
  }, [address]);

  const stats = useMemo(() => {
    const released = bounties.filter((b) => b.status === "released");
    const reserved = bounties.filter((b) => b.status === "reserved");
    const refunded = bounties.filter((b) => b.status === "refunded");
    const totalEarned = released.reduce((s, b) => s + (typeof b.amount === "number" ? b.amount : 0), 0);
    const completed = released.length;
    const activeReservations = reserved.length;
    const disputeRate = completed + refunded.length > 0 ? Math.round((refunded.length / (completed + refunded.length)) * 100) : 0;
    return { totalEarned, completed, activeReservations, disputeRate, released };
  }, [bounties]);

  return (
    <div className="contributor-page">
      <button type="button" className="link-button" onClick={onBack}>Back</button>
      <header>
        <h2>Contributor profile</h2>
        <div className="contributor-header">
          <strong>{shortAddress(address)}</strong>
          <CopyIcon text={address} label="contributor wallet address" />
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="reputation-section" style={{ marginBottom: '20px' }}>
        <h3>Reputation & Badges</h3>
        {loadingReputation ? (
          <div className="skeleton" style={{ height: '60px', background: '#f0f0f0', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 10px', color: '#888' }}>
            Loading reputation...
          </div>
        ) : (!reputation && badges.length === 0) ? (
          <p>No reputation data yet. Complete bounties to earn reputation!</p>
        ) : (
          <div className="reputation-content" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {reputation && (
              <div className="reputation-score">
                <span className="meta-label">Reputation Score: </span>
                <strong>{reputation.score}</strong>
              </div>
            )}
            
            {badges.length > 0 && (
              <div className="badge-gallery" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {badges.map((b) => (
                  <div key={b.id} className="badge" title={b.description} style={{ border: '1px solid #e1e4e8', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '80px' }}>
                    {b.imageUrl ? (
                      <img src={b.imageUrl} alt={b.name} style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
                    ) : (
                      <div style={{ width: '40px', height: '40px', background: '#e1e4e8', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🏆</div>
                    )}
                    <span style={{ fontSize: '12px', textAlign: 'center', marginTop: '5px', wordBreak: 'break-word' }}>{b.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <ContributorDashboard bounties={allBounties} loading={allBounties.length === 0 && !error} />

      <section className="metrics">
        <div>
          <span className="meta-label">Total earned</span>
          <strong>{stats.totalEarned} XLM</strong>
        </div>
        <div>
          <span className="meta-label">Completed bounties</span>
          <strong>{stats.completed}</strong>
        </div>
        <div>
          <span className="meta-label">Active reservations</span>
          <strong>{stats.activeReservations}</strong>
        </div>
        <div>
          <span className="meta-label">Dispute rate</span>
          <strong>{stats.disputeRate}%</strong>
        </div>
      </section>

      <section>
        <h3>Completed bounties</h3>
        {stats.released.length === 0 ? (
          <p>No completed bounties yet.</p>
        ) : (
          <ul className="completed-list">
            {stats.released.map((b) => (
              <li key={b.id}>
                <a href={`https://github.com/${b.repo}/issues/${b.issueNumber}`} target="_blank" rel="noreferrer">
                  {b.repo}#{b.issueNumber}
                </a>
                <span className="amount">{b.amount} {b.tokenSymbol}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Leaderboard</h3>
        {leaderboard.length === 0 ? (
          <p>No leaderboard data.</p>
        ) : (
          <ol>
            {leaderboard.slice(0, 5).map((entry: any) => (
              <li key={entry.address}>{entry.address} — {entry.totalXlm} XLM</li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
