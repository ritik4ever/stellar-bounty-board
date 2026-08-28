-- ============================================================================
-- Migration: 0000_initial_schema
-- Description: Creates the initial bounties, disputes, and audit_log tables
--              along with the required enum types.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

CREATE TYPE "bounty_status" AS ENUM (
  'open',
  'reserved',
  'submitted',
  'released',
  'refunded',
  'expired',
  'disputed'
);

CREATE TYPE "bounty_transition" AS ENUM (
  'create',
  'reserve',
  'submit',
  'release',
  'refund',
  'cancel',
  'expire',
  'dispute',
  'resolve_dispute',
  'update_notes',
  'extend_deadline'
);

-- ----------------------------------------------------------------------------
-- bounties
-- ----------------------------------------------------------------------------

CREATE TABLE "bounties" (
  "id"                          VARCHAR(64)    PRIMARY KEY,
  "repo"                        TEXT           NOT NULL,
  "issue_number"                INTEGER        NOT NULL,
  "title"                       TEXT           NOT NULL,
  "summary"                     TEXT           NOT NULL,
  "maintainer"                  VARCHAR(56)    NOT NULL,
  "contributor"                 VARCHAR(56),
  "token_symbol"                VARCHAR(20)    NOT NULL,
  "token_address"               TEXT           NOT NULL DEFAULT '',
  "amount"                      REAL           NOT NULL,
  "labels"                      JSONB          NOT NULL DEFAULT '[]',
  "status"                      "bounty_status" NOT NULL,
  "created_at"                  INTEGER        NOT NULL,
  "deadline_at"                 INTEGER        NOT NULL,
  "reserved_at"                 INTEGER,
  "submitted_at"                INTEGER,
  "released_at"                 INTEGER,
  "released_tx_hash"            TEXT,
  "protocol_fee_collected"      REAL,
  "refunded_at"                 INTEGER,
  "refunded_tx_hash"            TEXT,
  "canceled_at"                 INTEGER,
  "canceled_tx_hash"            TEXT,
  "submission_url"              TEXT,
  "notes"                       TEXT,
  "disputed_at"                 INTEGER,
  "dispute_reason"              TEXT,
  "last_dispute_alert_at"       INTEGER,
  "reservation_timeout_seconds" INTEGER,
  "archived"                    BOOLEAN        NOT NULL DEFAULT FALSE,
  "archived_at"                 INTEGER,
  "version"                     INTEGER        NOT NULL DEFAULT 1,
  "events"                      JSONB          NOT NULL DEFAULT '[]'
);

-- ----------------------------------------------------------------------------
-- disputes
-- ----------------------------------------------------------------------------

CREATE TABLE "disputes" (
  "id"                VARCHAR(64)  PRIMARY KEY,
  "bounty_id"         VARCHAR(64)  NOT NULL REFERENCES "bounties"("id") ON DELETE CASCADE,
  "raised_by"         VARCHAR(56)  NOT NULL,
  "reason"            TEXT         NOT NULL,
  "status"            VARCHAR(20)  NOT NULL DEFAULT 'open',
  "resolution_notes"  TEXT,
  "resolved_by"       VARCHAR(56),
  "raised_at"         INTEGER      NOT NULL,
  "resolved_at"       INTEGER
);

-- ----------------------------------------------------------------------------
-- audit_log
-- ----------------------------------------------------------------------------

CREATE TABLE "audit_log" (
  "id"           VARCHAR(64)         PRIMARY KEY,
  "bounty_id"    VARCHAR(64)         NOT NULL REFERENCES "bounties"("id") ON DELETE CASCADE,
  "from_status"  "bounty_status"     NOT NULL,
  "to_status"    "bounty_status"     NOT NULL,
  "transition"   "bounty_transition" NOT NULL,
  "actor"        VARCHAR(56)         NOT NULL,
  "timestamp"    INTEGER             NOT NULL,
  "metadata"     JSONB
);

-- ----------------------------------------------------------------------------
-- Indexes for common query patterns
-- ----------------------------------------------------------------------------

-- Look up bounties by repo + issue
CREATE INDEX "bounties_repo_issue_idx"   ON "bounties" ("repo", "issue_number");
-- Filter active bounties by status
CREATE INDEX "bounties_status_idx"       ON "bounties" ("status");
-- Fetch all disputes for a bounty
CREATE INDEX "disputes_bounty_id_idx"    ON "disputes" ("bounty_id");
-- Fetch full audit trail for a bounty, ordered by time
CREATE INDEX "audit_log_bounty_id_ts_idx" ON "audit_log" ("bounty_id", "timestamp");
