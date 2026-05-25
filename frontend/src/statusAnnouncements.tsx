import { useEffect, useState } from "react";
import type { BountyStatus } from "./types";

export const STATUS_ANNOUNCEMENT_CLEAR_MS = 3000;

const statusLabels: Record<BountyStatus, string> = {
  open: "Open",
  reserved: "Reserved",
  submitted: "Submitted",
  released: "Released",
  refunded: "Refunded",
  expired: "Expired",
};

type AnnounceableBounty = {
  id: string;
  issueNumber: number;
  status: BountyStatus;
};

export function formatStatusAnnouncement(bounty: AnnounceableBounty): string {
  return `Bounty #${bounty.issueNumber} status changed to ${statusLabels[bounty.status]}`;
}

export function getBountyStatusAnnouncement(
  previousBounties: ReadonlyArray<AnnounceableBounty>,
  nextBounties: ReadonlyArray<AnnounceableBounty>,
): string | null {
  const previousStatusById = new Map(
    previousBounties.map((bounty) => [bounty.id, bounty.status]),
  );

  const changedBounty = nextBounties.find((bounty) => {
    const previousStatus = previousStatusById.get(bounty.id);
    return previousStatus !== undefined && previousStatus !== bounty.status;
  });

  return changedBounty ? formatStatusAnnouncement(changedBounty) : null;
}

export function useStatusAnnouncement(clearMs = STATUS_ANNOUNCEMENT_CLEAR_MS) {
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!announcement) return;

    const timer = window.setTimeout(() => setAnnouncement(""), clearMs);
    return () => window.clearTimeout(timer);
  }, [announcement, clearMs]);

  return {
    announcement,
    announceStatus: setAnnouncement,
  };
}

export function StatusAnnouncement({ announcement }: { announcement: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
