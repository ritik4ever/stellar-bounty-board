export type BountyStatus =
  | "open"
  | "reserved"
  | "submitted"
  | "released"
  | "refunded"
  | "expired";

export interface Bounty {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  contributor?: string;
  tokenSymbol: string;
  amount: number;
  labels: string[];
  status: BountyStatus;
  createdAt: number;
  deadlineAt: number;
  reservedAt?: number;
  submittedAt?: number;
  releasedAt?: number;
  releasedTxHash?: string;
  refundedAt?: number;
  refundedTxHash?: string;
  submissionUrl?: string;
  notes?: string;
}

export interface CreateBountyPayload {
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  tokenSymbol: string;
  amount: number;
  deadlineDays: number;
  labels: string[];
}

export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  impact: "starter" | "core" | "advanced";
}

