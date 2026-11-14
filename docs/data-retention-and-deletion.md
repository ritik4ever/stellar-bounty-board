# Data Retention and Personal Data Deletion Policy

## Status

This document describes the current data-retention and deletion practices for the Stellar Bounty Board.

It is a GDPR-style operational policy intended to support data minimisation, retention control, access requests, and deletion requests. It is not legal advice and does not replace obligations that may apply to a particular deployment or jurisdiction.

## Scope

This policy applies to personal data processed by the Stellar Bounty Board backend, frontend, operational logs, notification integrations, persistent bounty stores, audit stores, caches, and backups.

The current platform does not maintain a separate user-account table. Maintainer and contributor identities are attached directly to bounty records and bounty lifecycle history.

A request to delete a maintainer or contributor account therefore means removing or pseudonymising the requester's personal identifiers from the platform's locally controlled records wherever this can be done without:

- breaking an active escrow or bounty workflow;
- preventing an unresolved dispute from being completed;
- removing records that must temporarily be retained for security, accounting, fraud-prevention, or legal reasons; or
- claiming to delete public data from Stellar or GitHub that the platform does not control.

## Personal Data Inventory

### 1. Stellar wallet addresses

The platform stores Stellar public wallet addresses for:

- bounty maintainers;
- bounty contributors;
- actors recorded in bounty event history;
- actors recorded in audit-log entries;
- authentication and authorisation checks;
- maintainer metrics and contributor dashboards;
- dispute and payout operations; and
- operational logs when an address is included in structured logging.

Typical fields include:

- `maintainer`;
- `contributor`;
- `events[].actor`;
- `auditLogs[].actor`;
- arbiter or administrator public addresses configured for a deployment; and
- public addresses included in audit metadata.

A Stellar public address is not a secret key. It may still be personal data when it can be connected to an identifiable person.

### 2. GitHub identities and activity

The platform stores or processes GitHub-related data including:

- repository owner and repository name in the `repo` field;
- GitHub issue numbers;
- issue titles, summaries, and labels;
- pull-request or submission URLs;
- GitHub usernames that may be visible inside repository or pull-request URLs;
- GitHub webhook event data needed to match a merged pull request to a submitted bounty; and
- pull-request URLs included in operational logs.

The current webhook handler uses the pull-request URL and merge status. It does not maintain a complete local copy of the user's GitHub profile or GitHub OAuth credentials.

GitHub continues to control copies of issues, pull requests, usernames, commits, comments, and repository activity hosted on GitHub.

### 3. Notification email addresses

Email addresses may be processed when email notifications are enabled.

The application passes the recipient address to the configured email provider during notification delivery. The current bounty record and Prisma schema do not contain a persisted email-address field.

Depending on deployment configuration, an email address may exist in:

- notification preferences managed outside the bounty store;
- deployment environment variables or secret-management systems;
- outbound email provider delivery records;
- webhook notification payloads; or
- operational error logs if an integration includes an address in an error.

Email addresses must not be added to bounty notes, audit metadata, or application logs unless they are required for an approved operational purpose.

### 4. Free-text information

Free-text fields may contain personal data entered by maintainers or contributors.

These fields include:

- bounty titles and summaries;
- submission notes;
- dispute reasons;
- event details;
- audit metadata; and
- webhook or notification payload details.

Users and maintainers should avoid entering unnecessary personal information in free-text fields.

### 5. Bounty, payment, and audit information

The platform stores bounty lifecycle information including:

- bounty identifiers;
- issue and repository references;
- bounty status;
- reservation, submission, release, refund, cancellation, and dispute timestamps;
- token symbols and reward amounts;
- transaction hashes;
- protocol-fee information;
- submission URLs;
- lifecycle events; and
- audit-log records.

Some of this information may be linked to a maintainer or contributor wallet address and therefore may be personal data.

### 6. Operational and security logs

Backend and hosting logs may contain:

- request IDs;
- request routes and response status codes;
- timestamps;
- IP addresses or network metadata collected by the hosting provider;
- wallet addresses included in structured events;
- bounty IDs;
- pull-request URLs;
- error details; and
- notification-delivery failures.

Secrets, private keys, authentication headers, cookies, and access tokens must remain redacted in accordance with `SECURITY.md`.

### 7. Cache and temporary processing data

Caches may contain derived copies of bounty records, wallet addresses, and public bounty information.

Temporary processing may also include:

- in-memory notification recipient lists;
- webhook request bodies;
- health-check probes;
- generated API responses; and
- temporary deployment or maintenance files.

Caches are not authoritative records and must be invalidated or allowed to expire after an erasure operation.

### 8. Backups and replicas

The JSON-backed store creates or may use:

- the primary bounty store;
- the bounty audit store;
- the automatic `.bak` copy of the primary store;
- operator-created maintenance backups;
- mounted persistent volumes; and
- hosting-provider snapshots.

Deletion work must include every locally controlled copy that may contain the identifier.

### 9. Public blockchain and third-party data

The platform cannot delete information already published to:

- the Stellar ledger;
- Stellar Horizon or RPC infrastructure;
- GitHub;
- email-provider records controlled by the provider;
- webhook recipients;
- public mirrors, forks, or archives; or
- third-party logs outside the platform operator's control.

A local deletion request removes or pseudonymises locally controlled copies. It does not rewrite the Stellar ledger or GitHub history.

## Retention Schedule

| Data category                                                                        | Retention period                                                                                      | End-of-retention action                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Active bounty records                                                                | For the complete open, reserved, submitted, or disputed lifecycle                                     | Retain until the bounty reaches a terminal state                               |
| Released, refunded, cancelled, or expired bounty records                             | 24 months after the terminal-state timestamp                                                          | Delete or pseudonymise personal identifiers unless a longer period is required |
| Bounty audit records                                                                 | 24 months after the related bounty reaches a terminal state                                           | Delete or pseudonymise wallet, GitHub, email, and free-text personal data      |
| Unresolved disputes or security investigations                                       | Until resolution plus the normal 24-month terminal retention period                                   | Review and apply the normal deletion process                                   |
| Notification email addresses stored in local preferences or deployment configuration | Until notification consent is withdrawn or the account is deleted                                     | Remove immediately from local preferences, secrets, and notification lists     |
| In-memory notification recipient data                                                | Only for the duration of notification dispatch                                                        | Discard after the dispatch attempt                                             |
| Email-provider delivery logs                                                         | No more than 30 days where provider configuration permits                                             | Configure provider expiry or submit provider deletion request                  |
| Application and hosting logs                                                         | 30 days by default                                                                                    | Automatically expire or securely delete                                        |
| Cache entries                                                                        | No longer than the configured cache TTL                                                               | Invalidate immediately following deletion or pseudonymisation                  |
| Automatic `.bak` file                                                                | Until replaced by a later successful write, subject to the same retention policy as the primary store | Sanitise during a deletion request                                             |
| Operator-created deletion backup                                                     | Maximum 7 days                                                                                        | Securely delete after verification                                             |
| General disaster-recovery snapshots                                                  | Maximum 30 days unless a documented legal or security hold applies                                    | Expire automatically; do not restore deleted PII into production               |
| Deletion-request case record                                                         | 24 months after completion                                                                            | Retain only request ID, dates, verification method, scope, and outcome         |
| Stellar ledger and GitHub public records                                             | Controlled by Stellar, GitHub, and other third parties                                                | Local deletion only; external erasure is not guaranteed                        |

A deployment may use a shorter retention period. Longer retention requires a documented purpose, named owner, restricted access, and review date.

## Existing Retention Lifecycle Jobs

### Reservation expiration job

`backend/src/services/reservationExpirationJob.ts` is the currently implemented automated lifecycle-cleanup job.

It:

- runs when the backend service starts;
- normally runs once per hour;
- uses `RESERVATION_TTL_DAYS`, defaulting to seven days;
- identifies stale reserved bounties;
- changes the live bounty status back to `open`;
- clears the live `contributor` field;
- clears `reservedAt`; and
- records an expiration event.

This job reduces the amount of contributor data held in the active bounty record after a stale reservation.

It is not a complete account-erasure mechanism because earlier event and audit records may still contain the contributor address.

### Cache invalidation

Bounty mutations invalidate the derived bounty-list cache. After a manual deletion or pseudonymisation, the backend must be restarted or the cache must be invalidated so a stale cached copy is not returned.

### Backup lifecycle

The JSON store may create a `.bak` copy before a write. A deletion process must sanitise or remove that copy as well as the primary and audit stores.

### Archival status

There is currently no automated account-archival or account-erasure background job.

Until such a job is implemented, terminal-record retention reviews and verified deletion requests use the supported operator maintenance procedure described below.

## Data-Deletion Request Process

### 1. Submit the request privately

The requester must not post personal data in a public GitHub issue.

Until a dedicated privacy mailbox is configured, the requester should use GitHub Private Vulnerability Reporting for the repository and prefix the title with:

```text
[DATA DELETION]
```
