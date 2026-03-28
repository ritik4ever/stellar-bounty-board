import { BountyStatus } from "./types";

export const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z0-9]{55}$/;
export const STELLAR_PUBLIC_KEY_HINT = "Enter a Stellar public key (starts with 'G', 56 characters)";

export const statusCopy: Record<BountyStatus, { label: string; description: string }> = {
  open: {
    label: "Open",
    description: "Available for contributors to reserve and work on.",
  },
  reserved: {
    label: "Reserved",
    description: "A contributor has claimed this bounty and is working on it.",
  },
  submitted: {
    label: "Submitted",
    description: "Work has been submitted and is awaiting maintainer review.",
  },
  released: {
    label: "Released",
    description: "Payment has been released to the contributor.",
  },
  refunded: {
    label: "Refunded",
    description: "Bounty was refunded to the maintainer.",
  },
  expired: {
    label: "Expired",
    description: "Bounty deadline passed without completion.",
  },
};

export const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "reserved", label: "Reserved" },
  { value: "submitted", label: "Submitted" },
  { value: "released", label: "Released" },
  { value: "refunded", label: "Refunded" },
  { value: "expired", label: "Expired" },
];

export const statusGlossary = Object.entries(statusCopy).map(([status, info]) => ({
  status,
  label: info.label,
  description: info.description,
}));

export interface FilterState {
  searchQuery: string;
  statusFilter: "all" | BountyStatus;
  minReward: string;
  maxReward: string;
}

export function readInitialFilters(): FilterState {
  const params = new URLSearchParams(window.location.search);
  return {
    searchQuery: params.get("search") ?? "",
    statusFilter: (params.get("status") as "all" | BountyStatus) ?? "all",
    minReward: params.get("minReward") ?? "",
    maxReward: params.get("maxReward") ?? "",
  };
}

export interface Action {
  type: "reserve" | "submit" | "release" | "refund";
  label: string;
  requires: "contributor" | "maintainer";
}

export const actionCopy: Record<BountyStatus, Action[]> = {
  open: [
    { type: "reserve", label: "Reserve", requires: "contributor" },
  ],
  reserved: [
    { type: "submit", label: "Submit", requires: "contributor" },
  ],
  submitted: [
    { type: "release", label: "Release", requires: "maintainer" },
    { type: "refund", label: "Refund", requires: "maintainer" },
  ],
  released: [],
  refunded: [],
  expired: [],
};
