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
  BountyNotOpen = 1,
  BountyNotFound = 2,
  BountyAlreadyReserved = 3,
  AlreadyInitialized = 4,
  NotInitialized = 5,
  NotAdmin = 6,
  NotArbiter = 7,
  ArbiterNotSet = 8,
  NoPendingArbiter = 9,
  TimelockNotElapsed = 10,
  InvalidAmount = 11,
  AmountTooSmall = 12,
  DeadlineMustBeInTheFuture = 13,
  DeadlineMustAdvance = 14,
  FeeRecipientNotSet = 15,
  TokenNotAllowed = 16,
  DisputeWindowOverrideTooSmall = 17,
  DisputeWindowOverrideTooLarge = 18,
  BountyMustBeReserved = 19,
  BountyMustBeSubmitted = 20,
  BountyNotExpiredYet = 21,
  BountyExpired = 22,
  BountyAlreadyFinalized = 23,
  CannotExtendFinalizedBounty = 24,
  MaintainerMismatch = 25,
  ContributorMismatch = 26,
  MissingContributor = 27,
  DisputeWindowNotMet = 28,
  ContractIsPaused = 29,
  InsufficientArbiterStake = 30,
  StakeTokenMismatch = 31,
  NoArbiterStake = 32,
  SlashExceedsStake = 33,
  NotCommitteeMember = 34,
  DuplicateCommitteeVote = 35,
  CommitteeSizeExceeded = 36,
  DuplicateCommitteeMember = 37,
  CommitteeNotConfigured = 38,
  InvalidFeeBps = 39,
  BountyIdOverflow = 40,
  BountyMustBeDisputed = 41,
  EscrowTransferFailed = 42,
  PayoutTransferFailed = 43,
  FeeTransferFailed = 44,
  RefundTransferFailed = 45,
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
  [ContractError.BountyNotOpen]: "BountyNotOpen",
  [ContractError.BountyNotFound]: "BountyNotFound",
  [ContractError.BountyAlreadyReserved]: "BountyAlreadyReserved",
  [ContractError.AlreadyInitialized]: "AlreadyInitialized",
  [ContractError.NotInitialized]: "NotInitialized",
  [ContractError.NotAdmin]: "NotAdmin",
  [ContractError.NotArbiter]: "NotArbiter",
  [ContractError.ArbiterNotSet]: "ArbiterNotSet",
  [ContractError.NoPendingArbiter]: "NoPendingArbiter",
  [ContractError.TimelockNotElapsed]: "TimelockNotElapsed",
  [ContractError.InvalidAmount]: "InvalidAmount",
  [ContractError.AmountTooSmall]: "AmountTooSmall",
  [ContractError.DeadlineMustBeInTheFuture]: "DeadlineMustBeInTheFuture",
  [ContractError.DeadlineMustAdvance]: "DeadlineMustAdvance",
  [ContractError.FeeRecipientNotSet]: "FeeRecipientNotSet",
  [ContractError.TokenNotAllowed]: "TokenNotAllowed",
  [ContractError.DisputeWindowOverrideTooSmall]: "DisputeWindowOverrideTooSmall",
  [ContractError.DisputeWindowOverrideTooLarge]: "DisputeWindowOverrideTooLarge",
  [ContractError.BountyMustBeReserved]: "BountyMustBeReserved",
  [ContractError.BountyMustBeSubmitted]: "BountyMustBeSubmitted",
  [ContractError.BountyNotExpiredYet]: "BountyNotExpiredYet",
  [ContractError.BountyExpired]: "BountyExpired",
  [ContractError.BountyAlreadyFinalized]: "BountyAlreadyFinalized",
  [ContractError.CannotExtendFinalizedBounty]: "CannotExtendFinalizedBounty",
  [ContractError.MaintainerMismatch]: "MaintainerMismatch",
  [ContractError.ContributorMismatch]: "ContributorMismatch",
  [ContractError.MissingContributor]: "MissingContributor",
  [ContractError.DisputeWindowNotMet]: "DisputeWindowNotMet",
  [ContractError.ContractIsPaused]: "ContractIsPaused",
  [ContractError.InsufficientArbiterStake]: "InsufficientArbiterStake",
  [ContractError.StakeTokenMismatch]: "StakeTokenMismatch",
  [ContractError.NoArbiterStake]: "NoArbiterStake",
  [ContractError.SlashExceedsStake]: "SlashExceedsStake",
  [ContractError.NotCommitteeMember]: "NotCommitteeMember",
  [ContractError.DuplicateCommitteeVote]: "DuplicateCommitteeVote",
  [ContractError.CommitteeSizeExceeded]: "CommitteeSizeExceeded",
  [ContractError.DuplicateCommitteeMember]: "DuplicateCommitteeMember",
  [ContractError.CommitteeNotConfigured]: "CommitteeNotConfigured",
  [ContractError.InvalidFeeBps]: "InvalidFeeBps",
  [ContractError.BountyIdOverflow]: "BountyIdOverflow",
  [ContractError.BountyMustBeDisputed]: "BountyMustBeDisputed",
  [ContractError.EscrowTransferFailed]: "EscrowTransferFailed",
  [ContractError.PayoutTransferFailed]: "PayoutTransferFailed",
  [ContractError.FeeTransferFailed]: "FeeTransferFailed",
  [ContractError.RefundTransferFailed]: "RefundTransferFailed",
};
