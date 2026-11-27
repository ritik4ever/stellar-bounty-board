/**
 * Service dependency error definitions (#1302).
 *
 * Wraps external failures (JSON store, GitHub API, Soroban RPC, file lock) in
 * typed errors carrying the operation attempted and the original cause.
 *
 * `message` and `publicMessage` are deliberately free of the cause's detail:
 * the original error is kept on `cause` for logging only, so rendering this
 * error can never leak a filesystem path, driver message, or stack to a client.
 */

export type ServiceDependency =
  | 'json-store'
  | 'github-api'
  | 'soroban-rpc'
  | 'file-lock'
  | 'notification';

export interface ServiceDependencyErrorOptions {
  /** Dotted name of the operation that was attempted, e.g. `bounty_store.read_store`. */
  operation: string;
  /** The external dependency that failed. */
  dependency: ServiceDependency;
  /** HTTP status the client receives. */
  statusCode?: number;
  /** Client-safe message. Must not contain driver, filesystem, or stack detail. */
  publicMessage?: string;
  /** The original error thrown by the dependency. Logged, never sent to the client. */
  cause: unknown;
}

export class ServiceDependencyError extends Error {
  readonly operation: string;
  readonly dependency: ServiceDependency;
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly cause: unknown;

  constructor(options: ServiceDependencyErrorOptions) {
    super(`${options.operation} failed (${options.dependency})`);
    this.name = 'ServiceDependencyError';
    this.operation = options.operation;
    this.dependency = options.dependency;
    this.statusCode =
      options.statusCode ??
      (options.dependency === 'github-api' || options.dependency === 'soroban-rpc' ? 502 : 500);
    this.publicMessage =
      options.publicMessage ??
      (options.dependency === 'github-api'
        ? 'GitHub issues service is temporarily unavailable.'
        : options.dependency === 'soroban-rpc'
          ? 'Stellar network service is temporarily unavailable.'
          : 'Failed to access persistent data store.');
    this.cause = options.cause;
  }
}

/**
 * Why a bounty transition lost the race (Issue #1925).
 *
 * - `BOUNTY_VERSION_CONFLICT`: the caller supplied `expectedVersion` and the
 *   stored record has already moved on. Re-read the bounty and retry.
 * - `BOUNTY_STATE_CONFLICT`: the record is at the expected version but the
 *   transition is not legal from its current status.
 */
export type BountyConflictCode = 'BOUNTY_VERSION_CONFLICT' | 'BOUNTY_STATE_CONFLICT';

export interface BountyTransitionConflictOptions {
  code: BountyConflictCode;
  /** Client-safe explanation of the defined outcome. */
  message: string;
  /** Version the store holds now, so the caller can retry against it. */
  currentVersion: number;
  /** Status the store holds now. */
  currentStatus: string;
}

/**
 * A concurrent state update was rejected with a defined outcome instead of a
 * 5xx. Always maps to HTTP 409 so clients know to refresh and retry.
 */
export class BountyTransitionConflictError extends Error {
  readonly statusCode = 409;
  readonly code: BountyConflictCode;
  readonly currentVersion: number;
  readonly currentStatus: string;

  constructor(options: BountyTransitionConflictOptions) {
    super(options.message);
    this.name = 'BountyTransitionConflictError';
    this.code = options.code;
    this.currentVersion = options.currentVersion;
    this.currentStatus = options.currentStatus;
  }
}

/**
 * Helper to wrap any unknown failure into a typed ServiceDependencyError while
 * preserving the original cause.
 */
export function wrapServiceError(
  operation: string,
  dependency: ServiceDependency,
  err: unknown,
  publicMessage?: string,
  statusCode?: number
): ServiceDependencyError {
  if (err instanceof ServiceDependencyError) {
    return err;
  }
  return new ServiceDependencyError({
    operation,
    dependency,
    cause: err,
    publicMessage,
    statusCode,
  });
}
