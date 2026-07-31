import { useMemo } from "react";
import { ArrowLeft, BarChart3, TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { Bounty, MaintainerMetrics } from "./types";

interface MaintainerAnalyticsPageProps {
  metrics: MaintainerMetrics;
  maintainerAddress: string;
  bounties: Bounty[];
  onBack: () => void;
}

export default function MaintainerAnalyticsPage({
  metrics,
  maintainerAddress,
  bounties,
  onBack,
}: MaintainerAnalyticsPageProps) {
  const shortAddress = (val: string) => `${val.slice(0, 6)}...${val.slice(-4)}`;

  // 1. Process Bar Chart Data (bounties by status)
  const statusData = useMemo(() => {
    return [
      { name: "Open", bounties: metrics.openCount, fill: "#1ebd93" },
      { name: "Reserved", bounties: metrics.reservedCount, fill: "#4b7fc4" },
      { name: "Submitted", bounties: metrics.submittedCount, fill: "#d9802e" },
      { name: "Released", bounties: metrics.releasedCount, fill: "#3a8f2a" },
      { name: "Refunded", bounties: metrics.refundedCount, fill: "#b8554b" },
      { name: "Expired", bounties: metrics.expiredCount, fill: "#777777" },
    ];
  }, [metrics]);

  // 2. Process Line Chart Data (cumulative funded vs released over time)
  const timelinePoints = useMemo(() => {
    const mBounties = bounties.filter((b) => b.maintainer === maintainerAddress);
    if (mBounties.length === 0) return [];

    // Extract all event points
    const events: Array<{ time: number; type: "funded" | "released"; amount: number }> = [];
    mBounties.forEach((b) => {
      // Creation marks the funding event
      events.push({ time: b.createdAt, type: "funded", amount: b.amount });
      // Release marks payout event
      if (b.status === "released" && b.releasedAt) {
        events.push({ time: b.releasedAt, type: "released", amount: b.amount });
      }
    });

    // Sort chronologically
    events.sort((a, b) => a.time - b.time);

    let cumulativeFunded = 0;
    let cumulativeReleased = 0;

    return events.map((ev) => {
      if (ev.type === "funded") {
        cumulativeFunded += ev.amount;
      } else {
        cumulativeReleased += ev.amount;
      }
      return {
        name: new Date(ev.time * 1000).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        "Total Funded": cumulativeFunded,
        "Total Released": cumulativeReleased,
      };
    });
  }, [bounties, maintainerAddress]);

  return (
    <div className="maintainer-analytics page-shell">
      <div className="analytics-header">
        <div className="analytics-header__info">
          <span className="meta-label">Maintainer Metrics</span>
          <h1 title={maintainerAddress}>Dashboard for {shortAddress(maintainerAddress)}</h1>
        </div>
        <button className="secondary-button" onClick={onBack} aria-label="Go back to dashboard">
          <ArrowLeft size={16} style={{ marginRight: 8 }} />
          Back to board
        </button>
      </div>

      {/* Summary cards */}
      <section className="analytics-grid" aria-label="Metrics Summary">
        <article className="analytics-card">
          <span>Total Bounties</span>
          <strong>{metrics.totalBounties}</strong>
        </article>
        <article className="analytics-card">
          <span>Total Funded</span>
          <strong>{metrics.totalFunded} XLM</strong>
        </article>
        <article className="analytics-card">
          <span>Total Released</span>
          <strong>{metrics.totalReleased} XLM</strong>
        </article>
        <article className="analytics-card">
          <span>Average Reward</span>
          <strong>{metrics.averageRewardAmount.toFixed(1)} XLM</strong>
        </article>
      </section>

      {/* Charts section */}
      <div className="charts-row">
        {/* Bar Chart */}
        <section className="chart-container" aria-labelledby="status-chart-title">
          <div className="analytics-header">
            <h2 id="status-chart-title" className="chart-title">Bounties by Status</h2>
            <BarChart3 size={18} className="text-muted" />
          </div>
          <div className="chart-wrapper" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={statusData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(54,63,59,0.08)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--ink)",
                    color: "#fff",
                    borderRadius: "8px",
                    border: "none",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="bounties" fill="#4b7fc4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Line Chart */}
        <section className="chart-container" aria-labelledby="funding-chart-title">
          <div className="analytics-header">
            <h2 id="funding-chart-title" className="chart-title">Cumulative Escrow Over Time</h2>
            <TrendingUp size={18} className="text-muted" />
          </div>
          <div className="chart-wrapper" style={{ height: 260 }}>
            {timelinePoints.length < 2 ? (
              <div className="empty-state" style={{ height: "100%", justifyContent: "center" }}>
                Not enough history to display line chart.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={timelinePoints}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(54,63,59,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ink)",
                      color: "#fff",
                      borderRadius: "8px",
                      border: "none",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="Total Funded"
                    stroke="#4b7fc4"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Total Released"
                    stroke="#1ebd93"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
