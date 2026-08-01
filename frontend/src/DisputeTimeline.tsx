import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, FileText, Gavel, Loader2 } from "lucide-react";
import type { DisputeEvent } from "./types";
import { getDisputeHistory } from "./api";

type Props = {
  bountyId: string;
  formatTimestamp: (value?: number) => string;
};

const EVENT_ICONS: Record<string, typeof AlertTriangle> = {
  dispute_raised: AlertTriangle,
  evidence_added: FileText,
  resolution: Gavel,
};

const EVENT_LABELS: Record<string, string> = {
  dispute_raised: "Dispute raised",
  evidence_added: "Evidence added",
  resolution: "Dispute resolved",
};

export default function DisputeTimeline({ bountyId, formatTimestamp }: Props) {
  const [events, setEvents] = useState<DisputeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    getDisputeHistory(bountyId)
      .then((data) => {
        if (mountedRef.current) {
          setEvents(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load dispute history");
          setLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [bountyId]);

  if (loading) {
    return (
      <div className="dispute-timeline">
        <h3 className="dispute-timeline__title">
          <AlertTriangle size={16} />
          Dispute history
        </h3>
        <div className="dispute-timeline__loading">
          <Loader2 size={18} className="spin" />
          Loading dispute history…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dispute-timeline">
        <h3 className="dispute-timeline__title">
          <AlertTriangle size={16} />
          Dispute history
        </h3>
        <p className="dispute-timeline__error">{error}</p>
      </div>
    );
  }

  if (!events || events.length === 0) {
    return null;
  }

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const IconComponent = EVENT_ICONS[sorted[0]?.type] ?? AlertTriangle;

  return (
    <div className="dispute-timeline">
      <h3 className="dispute-timeline__title">
        <IconComponent size={16} />
        Dispute history
      </h3>
      <ol className="dispute-timeline__list">
        {sorted.map((event, index) => {
          const Icon = EVENT_ICONS[event.type] ?? Clock;

          return (
            <li
              key={index}
              className={`dispute-timeline__item dispute-timeline__item--${event.type}`}
            >
              <div className="dispute-timeline__icon" aria-hidden="true">
                <Icon size={14} />
              </div>
              <div className="dispute-timeline__content">
                <div className="dispute-timeline__top">
                  <strong className="dispute-timeline__event">
                    {EVENT_LABELS[event.type] ?? event.type}
                  </strong>
                  <time
                    className="dispute-timeline__time"
                    dateTime={new Date(event.timestamp * 1000).toISOString()}
                  >
                    {formatTimestamp(event.timestamp)}
                  </time>
                </div>
                <p className="dispute-timeline__desc">
                  {event.description}
                </p>
                <span className="dispute-timeline__actor">by {event.actor}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}