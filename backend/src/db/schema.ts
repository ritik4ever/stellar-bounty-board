import {
  pgTable,
  pgEnum,
  text,
  integer,
  real,
  jsonb,
  boolean,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const bountyStatusEnum = pgEnum("bounty_status", [
  "open",
  "reserved",
  "submitted",
  "released",
  "refunded",
  "expired",
  "disputed",
]);

export const bountyTransitionEnum = pgEnum("bounty_transition", [
  "create",
  "reserve",
  "submit",
  "release",
  "refund",
  "cancel",
  "expire",
  "dispute",
  "resolve_dispute",
  "update_notes",
  "extend_deadline",
]);

// ---------------------------------------------------------------------------
// bounties
// ---------------------------------------------------------------------------

export const bounties = pgTable("bounties", {
  /** Unique bounty identifier (e.g. BNT-0001). */
  id: varchar("id", { length: 64 }).primaryKey(),

  /** GitHub repository path (e.g., owner/repo). */
  repo: text("repo").notNull(),

  /** Associated GitHub issue number. */
  issueNumber: integer("issue_number").notNull(),

  /** Title of the GitHub issue. */
  title: text("title").notNull(),

  /** Description/summary of the bounty. */
  summary: text("summary").notNull(),

  /** Stellar address of the maintainer who created the bounty. */
  maintainer: varchar("maintainer", { length: 56 }).notNull(),

  /** Stellar address of the contributor who reserved/submitted the bounty. */
  contributor: varchar("contributor", { length: 56 }),

  /** Payment token symbol (e.g., XLM, USDC). */
  tokenSymbol: varchar("token_symbol", { length: 20 }).notNull(),

  /** Resolved payment token contract address. */
  tokenAddress: text("token_address").notNull().default(""),

  /** The reward amount. */
  amount: real("amount").notNull(),

  /**
   * Array of labels/tags — stored as a JSON array for portability and to
   * avoid requiring the pg array extension in every environment.
   */
  labels: jsonb("labels").$type<string[]>().notNull().default([]),

  /** Current lifecycle status of the bounty. */
  status: bountyStatusEnum("status").notNull(),

  /** Unix timestamp (seconds) of bounty creation. */
  createdAt: integer("created_at").notNull(),

  /** Unix timestamp (seconds) of the bounty deadline. */
  deadlineAt: integer("deadline_at").notNull(),

  /** Unix timestamp (seconds) of when the bounty was reserved. */
  reservedAt: integer("reserved_at"),

  /** Unix timestamp (seconds) of when the submission was made. */
  submittedAt: integer("submitted_at"),

  /** Unix timestamp (seconds) of when the bounty was released. */
  releasedAt: integer("released_at"),

  /** Stellar transaction hash of the release payment. */
  releasedTxHash: text("released_tx_hash"),

  /** Protocol fee collected when this bounty was released (in token units). */
  protocolFeeCollected: real("protocol_fee_collected"),

  /** Unix timestamp (seconds) of when the bounty was refunded. */
  refundedAt: integer("refunded_at"),

  /** Stellar transaction hash of the refund payment. */
  refundedTxHash: text("refunded_tx_hash"),

  /** Unix timestamp (seconds) of when the bounty was canceled. */
  canceledAt: integer("canceled_at"),

  /** Stellar transaction hash of the cancellation payment. */
  canceledTxHash: text("canceled_tx_hash"),

  /** URL to the submission solution (e.g., Pull Request link). */
  submissionUrl: text("submission_url"),

  /** Submission notes left by the contributor. */
  notes: text("notes"),

  /** Unix timestamp (seconds) of when the bounty was disputed. */
  disputedAt: integer("disputed_at"),

  /** Reason provided by the contributor for disputing the bounty. */
  disputeReason: text("dispute_reason"),

  /** Unix timestamp (seconds) of the last admin alert sent for a stuck dispute. */
  lastDisputeAlertAt: integer("last_dispute_alert_at"),

  /** Number of seconds after reservation before it automatically times out. */
  reservationTimeoutSeconds: integer("reservation_timeout_seconds"),

  /** When true, the bounty has been soft-archived. */
  archived: boolean("archived").notNull().default(false),

  /** Unix timestamp (seconds) of when the bounty was archived. */
  archivedAt: integer("archived_at"),

  /** Optimistic-locking version counter. */
  version: integer("version").notNull().default(1),

  /**
   * Full event history — stored as JSONB so the append-only event log
   * travels with the row without requiring a separate join.
   */
  events: jsonb("events").$type<unknown[]>().notNull().default([]),
});

// ---------------------------------------------------------------------------
// disputes
// ---------------------------------------------------------------------------

export const disputes = pgTable("disputes", {
  /** Unique dispute identifier. */
  id: varchar("id", { length: 64 }).primaryKey(),

  /** ID of the disputed bounty. */
  bountyId: varchar("bounty_id", { length: 64 })
    .notNull()
    .references(() => bounties.id, { onDelete: "cascade" }),

  /** Stellar address of the contributor who raised the dispute. */
  raisedBy: varchar("raised_by", { length: 56 }).notNull(),

  /** Human-readable reason for the dispute. */
  reason: text("reason").notNull(),

  /** Current status of the dispute (open / resolved / dismissed). */
  status: varchar("status", { length: 20 }).notNull().default("open"),

  /** Resolution notes written by an admin when closing the dispute. */
  resolutionNotes: text("resolution_notes"),

  /** Stellar address of the admin who resolved the dispute. */
  resolvedBy: varchar("resolved_by", { length: 56 }),

  /** Unix timestamp (seconds) of when the dispute was raised. */
  raisedAt: integer("raised_at").notNull(),

  /** Unix timestamp (seconds) of when the dispute was resolved. */
  resolvedAt: integer("resolved_at"),
});

// ---------------------------------------------------------------------------
// audit_log
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  /** Unique audit record identifier. */
  id: varchar("id", { length: 64 }).primaryKey(),

  /** ID of the audited bounty. */
  bountyId: varchar("bounty_id", { length: 64 })
    .notNull()
    .references(() => bounties.id, { onDelete: "cascade" }),

  /** The bounty status before the transition. */
  fromStatus: bountyStatusEnum("from_status").notNull(),

  /** The bounty status after the transition. */
  toStatus: bountyStatusEnum("to_status").notNull(),

  /** The type of transition that was executed. */
  transition: bountyTransitionEnum("transition").notNull(),

  /** Stellar address or system actor who triggered the transition. */
  actor: varchar("actor", { length: 56 }).notNull(),

  /** Unix timestamp (seconds) when the transition occurred. */
  timestamp: integer("timestamp").notNull(),

  /** Additional structured metadata for the transition context. */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const bountiesRelations = relations(bounties, ({ many }) => ({
  disputes: many(disputes),
  auditLog: many(auditLog),
}));

export const disputesRelations = relations(disputes, ({ one }) => ({
  bounty: one(bounties, {
    fields: [disputes.bountyId],
    references: [bounties.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  bounty: one(bounties, {
    fields: [auditLog.bountyId],
    references: [bounties.id],
  }),
}));
