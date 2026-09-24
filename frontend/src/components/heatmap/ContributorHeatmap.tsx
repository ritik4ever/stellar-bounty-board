import React, { useMemo } from 'react';
import type { Bounty } from '../../types';
import './ContributorHeatmap.css';

interface ContributorHeatmapProps {
  bounties: Bounty[];
}

interface DayActivity {
  date: string; // YYYY-MM-DD
  count: number;
}

export default function ContributorHeatmap({ bounties }: ContributorHeatmapProps) {
  // Generate activity data
  const activityMap = useMemo(() => {
    const map = new Map<string, number>();

    const addActivity = (timestamp?: number) => {
      if (!timestamp) return;
      const dateStr = new Date(timestamp * 1000).toISOString().split('T')[0];
      map.set(dateStr, (map.get(dateStr) || 0) + 1);
    };

    bounties.forEach((bounty) => {
      // Assuming submittedAt and releasedAt are in seconds as per unix timestamps in similar Stellar projects
      // (or maybe milliseconds? Let's check if the value is usually > 1e11 it's ms, else s. But Date(x) takes ms. We multiply by 1000 if it's seconds. wait. I will check the API to be safe. If it's a Unix timestamp, usually * 1000)
      // I will assume it's in milliseconds if it's large, else seconds.
      const handleDate = (ts?: number) => {
        if (!ts) return;
        const ms = ts > 1e11 ? ts : ts * 1000;
        const dateStr = new Date(ms).toISOString().split('T')[0];
        map.set(dateStr, (map.get(dateStr) || 0) + 1);
      };
      
      handleDate(bounty.submittedAt);
      handleDate(bounty.releasedAt);
    });

    return map;
  }, [bounties]);

  // Generate calendar grid for the last 365 days
  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - 364); // Last 365 days including today
    
    // Adjust to start on the correct day of the week (e.g., Sunday)
    const startDay = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDay);

    const weeksGrid: { date: string; count: number; dateObj: Date }[][] = [];
    let currentWeek: { date: string; count: number; dateObj: Date }[] = [];
    const months: { label: string; weekIndex: number }[] = [];
    
    let currentMonth = -1;
    let currentDate = new Date(startDate);
    
    let weekIndex = 0;
    while (currentDate <= today || currentWeek.length > 0) {
      if (currentWeek.length === 7) {
        weeksGrid.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }
      
      if (currentDate > today && currentWeek.length === 0) {
        break; // We've finished adding days up to today, and the last week is pushed
      }

      const dateStr = currentDate.toISOString().split('T')[0];
      const month = currentDate.getMonth();
      
      // Track month changes for the header
      if (month !== currentMonth && currentDate.getDate() < 15) {
        months.push({ 
          label: currentDate.toLocaleString('default', { month: 'short' }), 
          weekIndex 
        });
        currentMonth = month;
      }

      currentWeek.push({
        date: dateStr,
        count: activityMap.get(dateStr) || 0,
        dateObj: new Date(currentDate)
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    if (currentWeek.length > 0) {
      // Fill the rest of the week with empty dates
      while (currentWeek.length < 7) {
        currentWeek.push({ date: '', count: 0, dateObj: new Date(0) });
      }
      weeksGrid.push(currentWeek);
    }

    return { weeks: weeksGrid, monthLabels: months };
  }, [activityMap]);

  const getIntensityClass = (count: number) => {
    if (count === 0) return 'activity-0';
    if (count === 1) return 'activity-1';
    if (count <= 3) return 'activity-2';
    if (count <= 5) return 'activity-3';
    return 'activity-4';
  };

  if (bounties.length === 0) {
    return (
      <div className="contributor-heatmap-container empty">
        <h3>Activity</h3>
        <p className="text-muted">No activity yet. Start contributing to see your heatmap!</p>
        <div className="heatmap-grid" aria-hidden="true">
           {/* Placeholder empty grid */}
           {Array.from({ length: 52 }).map((_, i) => (
             <div key={i} className="heatmap-week">
               {Array.from({ length: 7 }).map((_, j) => (
                 <div key={j} className="heatmap-cell activity-0"></div>
               ))}
             </div>
           ))}
        </div>
      </div>
    );
  }

  return (
    <div className="contributor-heatmap-container">
      <h3>Activity</h3>
      <div className="heatmap-scroll-wrapper">
        <div className="heatmap-wrapper">
          <div className="heatmap-months">
            {monthLabels.map((m, i) => (
              <div 
                key={i} 
                className="heatmap-month-label" 
                style={{ gridColumn: m.weekIndex + 1 }}
              >
                {m.label}
              </div>
            ))}
          </div>
          <div className="heatmap-body">
            <div className="heatmap-days-y">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>
            <div className="heatmap-grid">
              {weeks.map((week, i) => (
                <div key={i} className="heatmap-week">
                  {week.map((day, j) => {
                    if (!day.date) {
                      return <div key={j} className="heatmap-cell empty"></div>;
                    }
                    return (
                      <div
                        key={j}
                        className={`heatmap-cell ${getIntensityClass(day.count)}`}
                        title={`${day.count} activity on ${day.date}`}
                        data-date={day.date}
                        data-count={day.count}
                      ></div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
