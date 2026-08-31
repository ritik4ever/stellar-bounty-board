import { Clock } from "lucide-react";
import { DisputeEvent } from "./types";

const DISPUTE_EVENT_LABELS: Record<string, string> = {
  disputed: "Dispute raised",
  resolved: "Dispute resolved",
};

interface DisputeTimelineProps {
  events: DisputeEvent[];
  formatTimestamp: (value?: number) => string;
}

function DisputeTimeline({ events, formatTimestamp }: DisputeTimelineProps) {
  if (!events || events.length === 0) return null;

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="bounty-timeline">
      <h3 className="bounty-timeline__title">
        <Clock size={16} />
        Dispute timeline
      </h3>
      <ol className="bounty-timeline__list">
        {sorted.map((event, index) => (
          <li key={index} className={`bounty-timeline__item bounty-timeline__item--${event.type}`}>
            <div className="bounty-timeline__dot" aria-hidden="true" />
            <div className="bounty-timeline__content">
              <strong className="bounty-timeline__event">
                {DISPUTE_EVENT_LABELS[event.type] ?? event.type}
              </strong>
              <time className="bounty-timeline__time" dateTime={new Date(event.timestamp * 1000).toISOString()}>
                {formatTimestamp(event.timestamp)}
              </time>
              {event.actor && (
                <span className="bounty-timeline__actor">by {event.actor}</span>
              )}
              {event.description && (
                <p className="bounty-timeline__description">{event.description}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default DisputeTimeline;