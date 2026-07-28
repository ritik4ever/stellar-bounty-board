import { memo, useEffect, useState, type ReactNode } from "react";
import { Bounty } from "./types";
import { statusCopy, actionCopy } from "./constants";
import BountyCountdown from "./BountyCountdown";
import { xlmToUsd } from "./utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'a, button, input, select, textarea, summary, [role="button"], [role="link"]'
      )
    )
  );
}

// ---------------------------------------------------------------------------
// BountyAmount
// ---------------------------------------------------------------------------

const BountyAmount = memo(function BountyAmount({
  bounty,
}: {
  bounty: Bounty;
}) {
  const [usdAmount, setUsdAmount] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (bounty.tokenSymbol.toUpperCase() === "USDC") {
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(bounty.amount);
      setUsdAmount(formatted);
      return () => {
        active = false;
      };
    }

    if (bounty.tokenSymbol.toUpperCase() !== "XLM") {
      setUsdAmount(null);
      return () => {
        active = false;
      };
    }

    setUsdAmount(null);
    void xlmToUsd(bounty.amount).then((value) => {
      if (active) {
        setUsdAmount(value);
      }
    });

    return () => {
      active = false;
    };
  }, [bounty.amount, bounty.tokenSymbol]);

  return (
    <div className="amount-chip">
      <strong>
        {bounty.amount} {bounty.tokenSymbol}
      </strong>
      {usdAmount && <span>{usdAmount}</span>}
    </div>
  );
});

// ---------------------------------------------------------------------------
// BountyCard
// ---------------------------------------------------------------------------

export interface BountyCardProps {
  bounty: Bounty;
  onOpen: (id: string) => void;
  renderActionButton: (
    bounty: Bounty,
    action: {
      action: "reserve" | "submit" | "release" | "refund";
      label: string;
      title: string;
    }
  ) => ReactNode;
}

const BountyCard = memo(function BountyCard({
  bounty,
  onOpen,
  renderActionButton,
}: BountyCardProps) {
  const openCard = () => onOpen(bounty.id);

  return (
    <article
      className="bounty-card"
      tabIndex={0}
      aria-label={`Bounty: ${bounty.title}. Press Enter or Space to open details.`}
      onClick={(event) => {
        if (isInteractiveTarget(event.target) && event.target !== event.currentTarget) return;
        openCard();
      }}
      onKeyDown={(event) => {
        if (isInteractiveTarget(event.target) && event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openCard();
        }
      }}
    >
      <div className="bounty-card__top">
        <div>
          <span
            className={`status-pill status-pill--${bounty.status}`}
            title={statusCopy[bounty.status].label}
          >
            {statusCopy[bounty.status].label}
          </span>
          <h3>{bounty.title}</h3>
        </div>
        <BountyAmount bounty={bounty} />
      </div>

      <p className="bounty-summary">{bounty.summary}</p>

      <div className="meta-grid">
        <div>
          <span className="meta-label">Issue</span>
          <strong>
            <a
              className="inline-link"
              href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`}
              target="_blank"
              rel="noreferrer"
            >
              {bounty.repo} #{bounty.issueNumber}
            </a>
          </strong>
        </div>
        <div>
          <span className="meta-label">Deadline</span>
          <strong>
            <BountyCountdown deadlineAt={bounty.deadlineAt} status={bounty.status} />
          </strong>
        </div>
        <div>
          <span className="meta-label">Maintainer</span>
          <strong>{shortAddress(bounty.maintainer)}</strong>
        </div>
        <div>
          <span className="meta-label">Contributor</span>
          <strong>{bounty.contributor ? shortAddress(bounty.contributor) : "Open"}</strong>
        </div>
      </div>

      <div className="chip-row">
        {bounty.labels.map((label) => (
          <span className="chip" key={label.name}>
            {label.name}
          </span>
        ))}
      </div>

      <div className="action-row">
        {(actionCopy[bounty.status] ?? []).map((action) => renderActionButton(bounty, action))}
      </div>
    </article>
  );
});

export default BountyCard;