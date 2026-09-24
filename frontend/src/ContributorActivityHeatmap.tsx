import { useMemo, useState } from 'react';
import type { Bounty } from './types';

/* ─── Types ─────────────────────────────────────────────────────── */

export interface DayActivity {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ActivityHeatmapProps {
  bounties: Bounty[];
  contributorAddress?: string;
}

/* ─── Colour scale (4 levels + zero) ─────────────────────────────── */

const CELL_COLOURS = [
  'var(--heatmap-zero, #ebedf0)',
  'var(--heatmap-l1, #9be9a8)',
  'var(--heatmap-l2, #40c463)',
  'var(--heatmap-l3, #30a14e)',
  'var(--heatmap-l4, #216e39)',
];

function colourIndex(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

/* ─── Data helpers ────────────────────────────────────────────────── */

const DAY = 86_400_000;

/** Build a map of date → count from the contributor's relevant bounty events. */
function buildActivityMap(
  bounties: Bounty[],
  address: string,
): Map<string, number> {
  const map = new Map<string, number>();

  for (const bounty of bounties) {
    if (bounty.contributor !== address) continue;

    for (const event of bounty.events ?? []) {
      if (event.type === 'submitted' || event.type === 'released') {
        const date = new Date(event.timestamp).toISOString().slice(0, 10);
        map.set(date, (map.get(date) ?? 0) + 1);
      }
    }
  }

  return map;
}

/** Generate an array of 365 days ending at today (inclusive). */
function generateDayGrid(): DayActivity[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const days: DayActivity[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(todayMs - i * DAY);
    days.push({
      date: d.toISOString().slice(0, 10),
      count: 0,
    });
  }
  return days;
}

/* ─── Component ──────────────────────────────────────────────────── */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ContributorActivityHeatmap({
  bounties,
  contributorAddress,
}: ActivityHeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    date: string;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  const grid = useMemo(() => {
    if (!contributorAddress) return null;

    const activityMap = buildActivityMap(bounties, contributorAddress);
    const days = generateDayGrid();

    for (const day of days) {
      day.count = activityMap.get(day.date) ?? 0;
    }

    return days;
  }, [bounties, contributorAddress]);

  if (!grid) {
    return (
      <section className="heatmap-section" aria-label="Activity heatmap">
        <h3 className="heatmap-section__title">Activity</h3>
        <p className="heatmap-section__empty">
          Connect your wallet to see your contribution activity.
        </p>
      </section>
    );
  }

  const totalActivities = grid.reduce((s, d) => s + d.count, 0);
  const totalActiveDays = grid.filter((d) => d.count > 0).length;

  /* Split into weeks (Sunday-first columns). Each week is 7 rows. */
  const weeks: DayActivity[][] = [];
  for (let i = 0; i < grid.length; i += 7) {
    weeks.push(grid.slice(i, i + 7));
  }

  return (
    <section className="heatmap-section" aria-label="Activity heatmap">
      <div className="heatmap-section__header">
        <h3 className="heatmap-section__title">Activity</h3>
        <span className="heatmap-section__stats">
          {totalActivities} contribution{totalActivities !== 1 ? 's' : ''} in the last year
        </span>
      </div>

      <div className="heatmap-container">
        {/* Day-of-week labels */}
        <div className="heatmap-labels" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day} className="heatmap-labels__label">
              {day}
            </span>
          ))}
        </div>

        {/* Grid */}
        <div className="heatmap-grid" role="grid" aria-label="Contribution activity grid">
          {weeks.map((week, wi) => (
            <div key={wi} className="heatmap-grid__week" role="row">
              {week.map((day) => (
                <div
                  key={day.date}
                  className="heatmap-cell"
                  role="gridcell"
                  aria-label={`${day.count} contribution${day.count !== 1 ? 's' : ''} on ${day.date}`}
                  style={{ backgroundColor: CELL_COLOURS[colourIndex(day.count)] }}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTooltip({
                      date: day.date,
                      count: day.count,
                      x: rect.left + rect.width / 2,
                      y: rect.top - 8,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="heatmap-tooltip"
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <strong>{tooltip.count}</strong> contribution{tooltip.count !== 1 ? 's' : ''} on{' '}
          {new Date(tooltip.date + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </div>
      )}

      {totalActiveDays === 0 && (
        <p className="heatmap-section__empty">
          No contribution activity recorded yet. Start submitting bounties to build your heatmap!
        </p>
      )}
    </section>
  );
}