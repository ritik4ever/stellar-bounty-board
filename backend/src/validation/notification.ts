import { z } from 'zod';

/**
 * Validation schemas for the notification delivery worker trust boundary (#1947).
 *
 * The delivery worker processes caller-supplied recipients, event names, and
 * payloads, and it re-plays entries from an on-disk delivery journal. Both are
 * trust boundaries: an attacker who can enqueue a delivery or tamper with the
 * journal must not be able to inject mail headers, abuse the outbound webhook,
 * or escalate into oversized dispatches. Every schema below is deliberately
 * strict about shape/encoding but lenient about semantics so that callers
 * with novel-but-well-formed payloads keep working.
 */

const MAX_PAYLOAD_BYTES = 64 * 1024;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * A single notification recipient. `address` is opaque to this service (it may
 * be an email or a Stellar public key), so we only enforce that it is a
 * non-empty, bounded, control-character-free string. `role` is interpolated
 * into outbound payloads and is therefore constrained to a safe alphabet.
 */
export const notificationRecipientSchema = z.object({
  role: z
    .string()
    .trim()
    .min(1, 'recipient role must be non-empty')
    .max(64, 'recipient role is too long')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'recipient role must contain only letters, digits, hyphens, and underscores',
    ),
  address: z
    .string()
    .trim()
    .min(1, 'recipient address must be non-empty')
    .max(254, 'recipient address is too long')
    .refine(
      (value) => !CONTROL_CHARS.test(value),
      'recipient address must not contain control characters',
    ),
});

/**
 * Lifecycle event identifier. Intentionally not enum-restricted so that
 * forward-compatible events (e.g. `dispute_stuck_alert`, which is not in
 * NOTIFICATION_LIFECYCLE_TRANSITIONS) remain dispatchable. The format guard
 * rejects CRLF and other control characters that would otherwise leak into
 * email subjects.
 */
export const notificationEventSchema = z
  .string()
  .trim()
  .min(1, 'event must be non-empty')
  .max(64, 'event is too long')
  .regex(
    /^[a-z][a-z0-9_.]*$/,
    'event must be lowercase snake_case (letters, digits, underscores, dots)',
  );

/**
 * Payload envelope. Shape is left to callers (each event defines its own
 * fields), but the serialized form is bounded to prevent memory pressure and
 * accidental exfiltration of oversized blobs through the journal.
 */
export const notificationPayloadSchema = z
  .record(z.unknown())
  .refine(
    (payload) => {
      try {
        const serialized = JSON.stringify(payload);
        return typeof serialized === 'string' && serialized.length <= MAX_PAYLOAD_BYTES;
      } catch {
        return false;
      }
    },
    `notification payload must be JSON-serializable and <= ${MAX_PAYLOAD_BYTES} bytes`,
  );

/**
 * Optional caller-supplied idempotency key. Restricting the alphabet prevents
 * a caller from crafting a ref that collides with (or visually imitates)
 * another delivery's journal key, and rules out control characters.
 */
export const notificationDeliveryRefSchema = z
  .string()
  .trim()
  .min(1, 'deliveryRef must be non-empty')
  .max(128, 'deliveryRef is too long')
  .regex(
    /^[a-zA-Z0-9._:-]+$/,
    'deliveryRef must contain only letters, digits, and the characters . _ : -',
  );

export const sendNotificationInputSchema = z.object({
  recipients: z
    .array(notificationRecipientSchema)
    .min(1, 'at least one recipient is required')
    .max(1000, 'too many recipients in a single delivery'),
  event: notificationEventSchema,
  payload: notificationPayloadSchema,
  options: z
    .object({
      deliveryRef: notificationDeliveryRefSchema.optional(),
      workerId: z.string().trim().max(128).optional(),
    })
    .optional(),
});

/**
 * Shape of a persisted delivery-journal entry. Used as a defense-in-depth
 * check in `resumePendingNotificationDeliveries` so that a tampered journal
 * cannot smuggle malformed recipients, events, or payloads back through the
 * outbound dispatch path.
 */
export const notificationJournalEntrySchema = z.object({
  deliveryId: notificationDeliveryRefSchema,
  event: notificationEventSchema,
  payload: notificationPayloadSchema,
  recipients: z
    .array(notificationRecipientSchema)
    .min(1)
    .max(1000),
  channel: z.enum(['EMAIL', 'WEBHOOK']),
  status: z.enum(['in_progress', 'pending', 'completed']),
  outcomes: z.array(z.unknown()),
  attempts: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastError: z.string().optional(),
});

/**
 * Outbound webhook URL. https is required unconditionally: an `http://` or
 * `file://` target would let operator misconfiguration (or an attacker with
 * env-write access) redirect server-side POSTs into the internal network.
 */
export const webhookUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'webhook URL must use https://')
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'webhook URL must be a well-formed https URL');
