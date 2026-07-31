/**
 * TypeScript bindings for the Stellar Bounty Board Soroban contract.
 *
 * This file is generated from the contract ABI. Do not edit it manually.
 * Regenerate with: npm run gen:bindings
 */

export type Address = string;

export enum BountyStatus {
  Open = 0,
  Reserved = 1,
  Submitted = 2,
  Released = 3,
  Refunded = 4,
  Expired = 5,
  Disputed = 6,
}

export enum ContractError {
  InvalidAmount = 0,
  DeadlineMustBeInTheFuture = 1,
  BountyNotOpen = 2,
  BountyMustBeReserved = 3,
  ContributorMismatch = 4,
  MaintainerMismatch = 5,
  BountyMustBeSubmitted = 6,
  MissingContributor = 7,
  BountyAlreadyFinalized = 8,
  BountyNotExpiredYet = 9,
  BountyExpired = 10,
  DeadlineMustAdvance = 11,
  CannotExtendFinalizedBounty = 12,
  BountyNotFound = 13,
  NotArbiter = 14,
  DisputeWindowNotMet = 15,
}

export interface Bounty {
  maintainer: Address;
  contributor?: Address;
  token: Address;
  amount: string;
  repo: string;
  issue_number: number;
  title: string;
  deadline: string;
  status: BountyStatus;
  protocol_fee_bps: number;
  dispute_raised_at: string;
}

export interface FeeStats {
  total_collected: string;
  bounty_count: string;
}

export interface BountyCreated {
  bounty_id: string;
  maintainer: Address;
  token: Address;
  amount: string;
  repo: string;
  issue_number: number;
  protocol_fee_bps: number;
}

export interface BountyReserved {
  bounty_id: string;
  contributor: Address;
}

export interface BountySubmitted {
  bounty_id: string;
  contributor: Address;
}

export interface BountyReleased {
  bounty_id: string;
  contributor: Address;
  amount: string;
  fee_amount: string;
}

export interface BountyRefunded {
  bounty_id: string;
  maintainer: Address;
  amount: string;
}

export interface BountyCanceled {
  bounty_id: string;
  maintainer: Address;
  amount: string;
}

export interface BountyDisputed {
  bounty_id: string;
  contributor: Address;
  arbiter: Address;
}

export interface BountyResolved {
  bounty_id: string;
  arbiter: Address;
  release: boolean;
}

export interface BountyDeadlineExtended {
  bounty_id: string;
  new_deadline: string;
}

/**
 * Maps a contract BountyStatus enum value to the frontend status string used
 * by the REST API. This is the seam where frontend-contract drift is caught:
 * if the contract adds or renames a variant, TypeScript will flag the missing
 * switch case.
 */
export function contractStatusToFrontend(status: BountyStatus): string {
  switch (status) {
    case BountyStatus.Open:
      return "open";
    case BountyStatus.Reserved:
      return "reserved";
    case BountyStatus.Submitted:
      return "submitted";
    case BountyStatus.Released:
      return "released";
    case BountyStatus.Refunded:
      return "refunded";
    case BountyStatus.Expired:
      return "expired";
    case BountyStatus.Disputed:
      return "disputed";
    default: {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown contract status: ${status}`);
    }
  }
}

/**
 * Reverse of contractStatusToFrontend.
 */
export function frontendStatusToContract(status: string): BountyStatus {
  switch (status) {
    case "open":
      return BountyStatus.Open;
    case "reserved":
      return BountyStatus.Reserved;
    case "submitted":
      return BountyStatus.Submitted;
    case "released":
      return BountyStatus.Released;
    case "refunded":
      return BountyStatus.Refunded;
    case "expired":
      return BountyStatus.Expired;
    case "disputed":
      return BountyStatus.Disputed;
    default:
      throw new Error(`Unknown frontend status: ${status}`);
  }
}

/**
 * Human-readable labels for contract error codes. Useful for matching on-chain
 * failure reasons returned by the backend/indexer.
 */
export const CONTRACT_ERROR_LABELS: Record<ContractError, string> = {
  [ContractError.InvalidAmount]: "InvalidAmount",
  [ContractError.DeadlineMustBeInTheFuture]: "DeadlineMustBeInTheFuture",
  [ContractError.BountyNotOpen]: "BountyNotOpen",
  [ContractError.BountyMustBeReserved]: "BountyMustBeReserved",
  [ContractError.ContributorMismatch]: "ContributorMismatch",
  [ContractError.MaintainerMismatch]: "MaintainerMismatch",
  [ContractError.BountyMustBeSubmitted]: "BountyMustBeSubmitted",
  [ContractError.MissingContributor]: "MissingContributor",
  [ContractError.BountyAlreadyFinalized]: "BountyAlreadyFinalized",
  [ContractError.BountyNotExpiredYet]: "BountyNotExpiredYet",
  [ContractError.BountyExpired]: "BountyExpired",
  [ContractError.DeadlineMustAdvance]: "DeadlineMustAdvance",
  [ContractError.CannotExtendFinalizedBounty]: "CannotExtendFinalizedBounty",
  [ContractError.BountyNotFound]: "BountyNotFound",
  [ContractError.NotArbiter]: "NotArbiter",
  [ContractError.DisputeWindowNotMet]: "DisputeWindowNotMet",
};
