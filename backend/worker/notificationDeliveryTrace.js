// Notification delivery worker outcome tracing (#1948).
//
// Emits structured, redacted trace records for notification dispatch attempts
// across funding, reservation, submission, and payout transitions.
//
// Records use truncated SHA-256 references so operators and aggregators can correlate
// pending attempts, committed transitions, and failure retries (e.g. Webhook timeouts,
// SendGrid 429) without leaking secrets, recipient addresses, or webhook payloads.

import crypto from "node:crypto";

export const NOTIFICATION_DELIVERY_EVENT = "notification_delivery";

export const NOTIFICATION_DELIVERY_OUTCOMES = Object.freeze({
  pending: "pending",
  committed: "committed",
  failed: "failed",
});

/**
 * Deterministically hash an identifier/token into a truncated SHA-256 digest
 * so log aggregators can correlate delivery attempts, retries, and transitions
 * without leaking raw paging tokens, webhook secrets, API keys, or user addresses.
 *
 * @param {unknown} token
 * @returns {string | null}
 */
export function redactNotificationReference(token) {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^sha256:[0-9a-f]{16}$/.test(trimmed)) {
    return trimmed;
  }
  const digest = crypto.createHash("sha256").update(trimmed).digest("hex");
  return `sha256:${digest.slice(0, 16)}`;
}

/**
 * Recursively scrubs known sensitive patterns (Stellar secret keys, SendGrid API keys,
 * Bearer tokens, email addresses, webhook signatures) from loggable strings.
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubSensitiveData(text) {
  return String(text)
    .replace(/S[0-9A-Z]{55}/g, "[redacted-secret-key]")
    .replace(/SG\.[A-Za-z0-9_-]+/g, "[redacted-sendgrid-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted-token]")
    .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, "[redacted-email]")
    .replace(/sha256=[0-9a-fA-F]{64}/g, "sha256=[redacted-signature]");
}

/**
 * Build a structured, single-line trace record.
 *
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
export function buildNotificationDeliveryTrace(input) {
  const allowedOutcomes = Object.values(NOTIFICATION_DELIVERY_OUTCOMES);
  if (!allowedOutcomes.includes(input.outcome)) {
    throw new Error(
      `unknown notification delivery trace outcome: ${input.outcome}; must be one of ${allowedOutcomes.join(", ")}`
    );
  }

  const channel = (
    input.channel ? String(input.channel).toUpperCase() : "WEBHOOK"
  );

  const bountyId =
    input.bountyId != null && input.bountyId !== "" ? String(input.bountyId) : null;

  return {
    event: NOTIFICATION_DELIVERY_EVENT,
    outcome: input.outcome,
    at: input.at ?? new Date().toISOString(),
    channel,
    lifecycleEvent: input.lifecycleEvent ? String(input.lifecycleEvent) : "unknown",
    bountyId,
    eventRef: redactNotificationReference(input.eventRef ?? input.eventId),
    deliveryRef: redactNotificationReference(input.deliveryRef ?? input.deliveryId),
    cursorRef: redactNotificationReference(input.cursorRef ?? input.cursor),
    recipientCount:
      typeof input.recipientCount === "number" && Number.isFinite(input.recipientCount)
        ? input.recipientCount
        : undefined,
    recipientRef: redactNotificationReference(input.recipientRef ?? input.recipient),
    statusCode:
      typeof input.statusCode === "number" && Number.isFinite(input.statusCode)
        ? input.statusCode
        : null,
    reason: typeof input.reason === "string" ? input.reason : null,
    error: typeof input.error === "string" ? scrubSensitiveData(input.error) : null,
  };
}

/**
 * Create a trace emitter that hands every record to `sink`.
 *
 * @param {(record: ReturnType<typeof buildNotificationDeliveryTrace>) => void} sink
 */
export function createNotificationDeliveryTrace(sink) {
  if (typeof sink !== "function") {
    throw new TypeError("notification delivery trace sink must be a function");
  }

  const emit = (outcome) => (entry) => {
    const record = buildNotificationDeliveryTrace({ ...entry, outcome });
    sink(record);
    return record;
  };

  return {
    pending: emit(NOTIFICATION_DELIVERY_OUTCOMES.pending),
    committed: emit(NOTIFICATION_DELIVERY_OUTCOMES.committed),
    failed: emit(NOTIFICATION_DELIVERY_OUTCOMES.failed),
  };
}

/**
 * Default console trace emitter: single-line JSON with worker prefix.
 *
 * @param {Pick<Console, "log">} [logger]
 */
export function createConsoleNotificationDeliveryTrace(logger = console) {
  return createNotificationDeliveryTrace((record) => {
    logger.log(`[NotificationWorker][delivery-trace] ${JSON.stringify(record)}`);
  });
}
