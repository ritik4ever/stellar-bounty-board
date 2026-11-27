import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  TrendingUp,
  FileText,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
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
} from 'recharts';
import { Bounty, MaintainerMetrics } from './types';
import {
  generateExportFileName,
  exportSvgAsPng,
  exportCombinedAnalyticsPdf,
} from './utils/analyticsExport';

interface MaintainerAnalyticsPageProps {
  metrics: MaintainerMetrics;
  maintainerAddress: string;
  bounties: Bounty[];
  onBack: () => void;
  loading?: boolean;
}

export default function MaintainerAnalyticsPage({
  metrics,
  maintainerAddress,
  bounties,
  onBack,
  loading = false,
}: MaintainerAnalyticsPageProps) {
  const shortAddress = (val: string) => `${val.slice(0, 6)}...${val.slice(-4)}`;

  const [exporting, setExporting] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const statusChartRef = useRef<HTMLElement>(null);
  const fundingChartRef = useRef<HTMLElement>(null);

  const handleExportPdf = async () => {
    if (!pageRef.current || exporting) return;
    setExporting('pdf');
    try {
      const fileName = generateExportFileName('maintainer-analytics', maintainerAddress, 'pdf');
      await exportCombinedAnalyticsPdf(pageRef.current, maintainerAddress, fileName);
      toast.success('Analytics PDF exported successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export PDF.');
    } finally {
      setExporting(null);
    }
  };

  const handleExportChartPng = async (
    chartKey: 'status' | 'funding',
    containerRef: React.RefObject<HTMLElement | null>,
    chartTitle: string
  ) => {
    if (!containerRef.current || exporting) return;
    setExporting(`${chartKey}-png`);
    try {
      const fileName = generateExportFileName(
        `analytics-${chartKey}-chart`,
        maintainerAddress,
        'png'
      );
      await exportSvgAsPng(containerRef.current, fileName);
      toast.success(`${chartTitle} chart exported as PNG!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to export ${chartTitle} chart.`);
    } finally {
      setExporting(null);
    }
  };

  // 1. Process Bar Chart Data (bounties by status)
  const statusData = useMemo(() => {
    return [
      { name: 'Open', bounties: metrics.openCount, fill: '#1ebd93' },
      { name: 'Reserved', bounties: metrics.reservedCount, fill: '#4b7fc4' },
      { name: 'Submitted', bounties: metrics.submittedCount, fill: '#d9802e' },
      { name: 'Released', bounties: metrics.releasedCount, fill: '#3a8f2a' },
      { name: 'Refunded', bounties: metrics.refundedCount, fill: '#b8554b' },
      { name: 'Expired', bounties: metrics.expiredCount, fill: '#777777' },
    ];
  }, [metrics]);

  // 2. Process Line Chart Data (cumulative funded vs released over time)
  const timelinePoints = useMemo(() => {
    const mBounties = bounties.filter((b) => b.maintainer === maintainerAddress);
    if (mBounties.length === 0) return [];

    // Extract all event points
    const events: Array<{ time: number; type: 'funded' | 'released'; amount: number }> = [];
    mBounties.forEach((b) => {
      // Creation marks the funding event
      events.push({ time: b.createdAt, type: 'funded', amount: b.amount });
      // Release marks payout event
      if (b.status === 'released' && b.releasedAt) {
        events.push({ time: b.releasedAt, type: 'released', amount: b.amount });
      }
    });

    // Sort chronologically
    events.sort((a, b) => a.time - b.time);

    let cumulativeFunded = 0;
    let cumulativeReleased = 0;

    return events.map((ev) => {
      if (ev.type === 'funded') {
        cumulativeFunded += ev.amount;
      } else {
        cumulativeReleased += ev.amount;
      }
      return {
        name: new Date(ev.time * 1000).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        'Total Funded': cumulativeFunded,
        'Total Released': cumulativeReleased,
      };
    });
  }, [bounties, maintainerAddress]);

  return (
    <div ref={pageRef} className="maintainer-analytics page-shell">
      <div className="analytics-header">
        <div className="analytics-header__info">
          <span className="meta-label">Maintainer Metrics</span>
          <h1 title={maintainerAddress}>Dashboard for {shortAddress(maintainerAddress)}</h1>
        </div>
        <div
          className="analytics-header__actions"
          style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={handleExportPdf}
            disabled={!!exporting}
            aria-label="Export full analytics report as PDF"
            data-testid="export-analytics-pdf"
            title="Export full analytics as PDF"
          >
            {exporting === 'pdf' ? (
              <Loader2 size={16} className="animate-spin" style={{ marginRight: 6 }} />
            ) : (
              <FileText size={16} style={{ marginRight: 6 }} />
            )}
            {exporting === 'pdf' ? 'Exporting PDF...' : 'Export PDF'}
          </button>
          <button className="secondary-button" onClick={onBack} aria-label="Go back to dashboard">
            <ArrowLeft size={16} style={{ marginRight: 8 }} />
            Back to board
          </button>
        </div>
      </div>

      {loading ? (
        <AnalyticsChartsSkeleton />
      ) : (
        <>
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
            <section
              ref={statusChartRef}
              className="chart-container"
              aria-labelledby="status-chart-title"
            >
              <div
                className="analytics-header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 id="status-chart-title" className="chart-title">
                    Bounties by Status
                  </h2>
                  <BarChart3 size={18} className="text-muted" />
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    handleExportChartPng('status', statusChartRef, 'Bounties by Status')
                  }
                  disabled={!!exporting}
                  aria-label="Export Bounties by Status chart as PNG"
                  data-testid="export-status-chart-png"
                  title="Export as PNG"
                  style={{ fontSize: '12px', padding: '4px 8px' }}
                >
                  {exporting === 'status-png' ? (
                    <Loader2 size={14} className="animate-spin" style={{ marginRight: 4 }} />
                  ) : (
                    <ImageIcon size={14} style={{ marginRight: 4 }} />
                  )}
                  {exporting === 'status-png' ? 'Exporting...' : 'Export PNG'}
                </button>
              </div>
              <div className="chart-wrapper" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={statusData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgba(54,63,59,0.08)"
                    />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--ink)',
                        color: '#fff',
                        borderRadius: '8px',
                        border: 'none',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="bounties" fill="#4b7fc4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Line Chart */}
            <section
              ref={fundingChartRef}
              className="chart-container"
              aria-labelledby="funding-chart-title"
            >
              <div
                className="analytics-header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 id="funding-chart-title" className="chart-title">
                    Cumulative Escrow Over Time
                  </h2>
                  <TrendingUp size={18} className="text-muted" />
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    handleExportChartPng('funding', fundingChartRef, 'Cumulative Escrow')
                  }
                  disabled={!!exporting || timelinePoints.length < 2}
                  aria-label="Export Cumulative Escrow chart as PNG"
                  data-testid="export-funding-chart-png"
                  title="Export as PNG"
                  style={{ fontSize: '12px', padding: '4px 8px' }}
                >
                  {exporting === 'funding-png' ? (
                    <Loader2 size={14} className="animate-spin" style={{ marginRight: 4 }} />
                  ) : (
                    <ImageIcon size={14} style={{ marginRight: 4 }} />
                  )}
                  {exporting === 'funding-png' ? 'Exporting...' : 'Export PNG'}
                </button>
              </div>
              <div className="chart-wrapper" style={{ height: 260 }}>
                {timelinePoints.length < 2 ? (
                  <div className="empty-state" style={{ height: '100%', justifyContent: 'center' }}>
                    Not enough history to display line chart.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart
                      data={timelinePoints}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(54,63,59,0.08)" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--ink)',
                          color: '#fff',
                          borderRadius: '8px',
                          border: 'none',
                          fontSize: '12px',
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
        </>
      )}
    </div>
  );
}

/**
 * Skeleton placeholder for the analytics charts page.
 * Mirrors the layout of the summary cards + chart containers
 * to prevent layout shift while data is being fetched.
 */
function AnalyticsChartsSkeleton() {
  return (
    <>
      <section className="analytics-grid" aria-label="Loading metrics" aria-busy="true">
        {[1, 2, 3, 4].map((i) => (
          <article className="analytics-card" key={i} aria-hidden="true">
            <span className="skeleton-block skeleton-meta-label" />
            <strong className="skeleton-block skeleton-meta-value" style={{ marginTop: 8 }} />
          </article>
        ))}
      </section>
      <div className="charts-row">
        {[1, 2].map((i) => (
          <section className="chart-container" key={i} aria-hidden="true">
            <div className="analytics-header">
              <span className="skeleton-block skeleton-title" style={{ width: 180, height: 20 }} />
            </div>
            <div className="chart-wrapper" style={{ height: 260 }}>
              <div
                className="skeleton-block"
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 8,
                }}
              />
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
