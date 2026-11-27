/**
 * Operational configuration for backend background services and data stores.
 *
 * Sourced from environment variables with safe defaults.
 * Allows operators to tune background intervals, retention windows,
 * and caching TTLs without code changes or redeployments.
 */

export interface ServicesConfig {
  /** Cache TTL in seconds for the complete bounty list. Source: BOUNTY_LIST_CACHE_TTL_SECONDS (default: 5) */
  bountyListCacheTtlSeconds: number;

  /** Cache TTL in seconds for computed global metrics. Source: GLOBAL_METRICS_CACHE_TTL_SECONDS (default: 30) */
  globalMetricsCacheTtlSeconds: number;

  /** Cache TTL in milliseconds for GitHub open issues feed. Source: OPEN_ISSUES_CACHE_TTL_MS (default: 600,000 = 10m) */
  openIssuesCacheTtlMs: number;

  /** Default repository slug for open issue discovery. Source: OPEN_ISSUES_DEFAULT_REPO */
  openIssuesDefaultRepo: string;

  /** Polling interval in ms for the automatic archival scheduler. Source: ARCHIVE_JOB_INTERVAL_MS (default: 86,400,000 = 24h) */
  archiveJobIntervalMs: number;

  /** Retention window in days before terminal bounties are archived. Source: ARCHIVE_AFTER_DAYS (default: 90) */
  archiveRetentionDays: number;

  /** Polling interval in ms for stale reservation expiration job. Source: RESERVATION_EXPIRATION_INTERVAL_MS (default: 3,600,000 = 1h) */
  expirationJobIntervalMs: number;

  /** Default reservation TTL in days. Source: RESERVATION_TTL_DAYS (default: 7) */
  expirationTtlDays: number;

  /** Polling interval in ms for stuck dispute scanner. Source: DISPUTE_ALERT_JOB_INTERVAL_MS (default: 3,600,000 = 1h) */
  disputeAlertIntervalMs: number;

  /** Maximum hours a dispute may remain unresolved before alerting. Source: DISPUTE_SLA_HOURS (default: 72) */
  disputeSlaHours: number;

  /** Minimum cooldown hours between consecutive dispute alerts. Source: DISPUTE_ALERT_INTERVAL_HOURS (default: 24) */
  disputeAlertIntervalHours: number;

  /** Polling interval in ms for recurring bounty scheduler. Source: RECURRING_SCHEDULER_INTERVAL_MS (default: 60,000 = 1m) */
  recurringSchedulerIntervalMs: number;
}

/**
 * Returns the effective services configuration.
 * Never throws — malformed or out-of-range inputs fall back to documented defaults.
 */
export function getServicesConfig(): ServicesConfig {
  const bountyListCacheTtlSeconds = (() => {
    const raw = Number(process.env.BOUNTY_LIST_CACHE_TTL_SECONDS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
  })();

  const globalMetricsCacheTtlSeconds = (() => {
    const raw = Number(process.env.GLOBAL_METRICS_CACHE_TTL_SECONDS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
  })();

  const openIssuesCacheTtlMs = (() => {
    const raw = Number(process.env.OPEN_ISSUES_CACHE_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10 * 60 * 1000;
  })();

  const openIssuesDefaultRepo =
    process.env.OPEN_ISSUES_DEFAULT_REPO?.trim() || 'ritik4ever/stellar-bounty-board';

  const archiveJobIntervalMs = (() => {
    const raw = Number(process.env.ARCHIVE_JOB_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 86_400_000;
  })();

  const archiveRetentionDays = (() => {
    const raw = Number(process.env.ARCHIVE_AFTER_DAYS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90;
  })();

  const expirationJobIntervalMs = (() => {
    const raw = Number(process.env.RESERVATION_EXPIRATION_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3_600_000;
  })();

  const expirationTtlDays = (() => {
    const raw = Number(process.env.RESERVATION_TTL_DAYS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
  })();

  const disputeAlertIntervalMs = (() => {
    const raw = Number(process.env.DISPUTE_ALERT_JOB_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3_600_000;
  })();

  const disputeSlaHours = (() => {
    const raw = Number(process.env.DISPUTE_SLA_HOURS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 72;
  })();

  const disputeAlertIntervalHours = (() => {
    const raw = Number(process.env.DISPUTE_ALERT_INTERVAL_HOURS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 24;
  })();

  const recurringSchedulerIntervalMs = (() => {
    const raw = Number(process.env.RECURRING_SCHEDULER_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60_000;
  })();

  return {
    bountyListCacheTtlSeconds,
    globalMetricsCacheTtlSeconds,
    openIssuesCacheTtlMs,
    openIssuesDefaultRepo,
    archiveJobIntervalMs,
    archiveRetentionDays,
    expirationJobIntervalMs,
    expirationTtlDays,
    disputeAlertIntervalMs,
    disputeSlaHours,
    disputeAlertIntervalHours,
    recurringSchedulerIntervalMs,
  };
}
