import { BountyStatus } from "./types";
import { SortOption, SortState } from "./utils";

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

export const sortOptions = [
  { value: "newest", label: "Newest first", direction: "desc" as const },
  { value: "oldest", label: "Oldest first", direction: "asc" as const },
  { value: "reward-high", label: "Highest reward", direction: "desc" as const },
  { value: "reward-low", label: "Lowest reward", direction: "asc" as const },
  { value: "deadline-soonest", label: "Deadline soonest", direction: "asc" as const },
  { value: "deadline-latest", label: "Deadline latest", direction: "desc" as const },
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
  repoFilter: string;
  tokenFilter: string;
  sortOption: SortOption;
  sortDirection: "asc" | "desc";
}

export function readInitialFilters(): FilterState {
  const params = new URLSearchParams(window.location.search);
  return {
    searchQuery: params.get("search") ?? "",
    statusFilter: (params.get("status") as "all" | BountyStatus) ?? "all",
    minReward: params.get("minReward") ?? "",
    maxReward: params.get("maxReward") ?? "",
    repoFilter: params.get("repo") ?? "",
    tokenFilter: params.get("tokenSymbol") ?? "",
    sortOption: (params.get("sort") as SortOption) ?? "newest",
    sortDirection: (params.get("direction") as "asc" | "desc") ?? "desc",
  };
}

export interface Action {
  action: "reserve" | "submit" | "release" | "refund";
  label: string;
  title: string;
  requires: "contributor" | "maintainer";
}

export const actionCopy: Record<BountyStatus, Action[]> = {
  open: [
    { action: "reserve", label: "Reserve", title: "Claim this bounty as a contributor.", requires: "contributor" },
  ],
  reserved: [
    { action: "submit", label: "Submit", title: "Attach a pull request or demo link.", requires: "contributor" },
  ],
  submitted: [
    { action: "release", label: "Release", title: "Release payout after review.", requires: "maintainer" },
    { action: "refund", label: "Refund", title: "Refund escrow instead of releasing.", requires: "maintainer" },
  ],
  released: [],
  refunded: [],
  expired: [
    { action: "refund", label: "Refund", title: "Refund an expired bounty.", requires: "maintainer" },
  ],
};
