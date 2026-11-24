import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_DELIVERY_EVENT,
  NOTIFICATION_DELIVERY_OUTCOMES,
  NotificationDeliveryTraceRecord,
  buildNotificationDeliveryTrace,
  createConsoleNotificationDeliveryTrace,
  createNotificationDeliveryTrace,
  redactNotificationReference,
  scrubSensitiveData,
  setGlobalNotificationDeliveryTraceSink,
} from '../src/services/notificationDeliveryTrace';
import { sendNotification, setNotificationOptIn, clearNotificationOptIns } from '../src/services/notificationService';

// ── Helpers ──────────────────────────────────────────────────────────────────

const RECIPIENTS = [
  { role: 'maintainer', address: 'maintainer@example.com' },
  { role: 'contributor', address: 'contributor@example.com' },
];

const PAYLOAD = {
  bountyId: 'BNT-0042',
  title: 'Implement soroban payout tracing',
  amount: 250,
  tokenSymbol: 'USDC',
};

function okResponse(status = 200, body = '{}'): Response {
  return new Response(body, { status });
}

function errResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

// ── Unit Tests: Redaction & Scrubbing ────────────────────────────────────────

describe('redactNotificationReference (#1948)', () => {
  it('maps an identifier or token to a stable, prefixed, truncated sha256 digest', () => {
    const first = redactNotificationReference('delivery-abc-123');
    expect(first).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(redactNotificationReference('delivery-abc-123')).toBe(first);
    expect(redactNotificationReference('delivery-xyz-789')).not.toBe(first);
  });

  it('preserves an already-redacted reference without double-hashing', () => {
    const existing = 'sha256:0123456789abcdef';
    expect(redactNotificationReference(existing)).toBe(existing);
  });

  it('never echoes raw tokens or secret content', () => {
    const secret = 'super-secret-token-12345';
    const ref = redactNotificationReference(secret);
    expect(ref).not.toContain('super-secret');
    expect(ref).not.toContain('12345');
  });

  it('returns null for non-string or empty inputs', () => {
    expect(redactNotificationReference(null)).toBeNull();
    expect(redactNotificationReference(undefined)).toBeNull();
    expect(redactNotificationReference('')).toBeNull();
    expect(redactNotificationReference('   ')).toBeNull();
    expect(redactNotificationReference(12345)).toBeNull();
    expect(redactNotificationReference({})).toBeNull();
  });
});

describe('scrubSensitiveData (#1948)', () => {
  it('scrubs Stellar secret keys from error messages', () => {
    const secretKey = 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const msg = `Failed transaction with signer ${secretKey}: bad auth`;
    expect(scrubSensitiveData(msg)).toBe(
      'Failed transaction with signer [redacted-secret-key]: bad auth'
    );
  });

  it('scrubs SendGrid API keys and Bearer tokens', () => {
    const msg = 'Error from https://api.sendgrid.com with SG.abcdef123456_XYZ and Bearer secret-token-val';
    const scrubbed = scrubSensitiveData(msg);
    expect(scrubbed).not.toContain('SG.abcdef123456_XYZ');
    expect(scrubbed).not.toContain('secret-token-val');
    expect(scrubbed).toContain('[redacted-sendgrid-key]');
    expect(scrubbed).toContain('Bearer [redacted-token]');
  });

  it('scrubs email addresses and webhook signatures', () => {
    const msg = 'Delivery to dev@example.com failed with X-Bounty-Signature sha256=' + 'a'.repeat(64);
    const scrubbed = scrubSensitiveData(msg);
    expect(scrubbed).not.toContain('dev@example.com');
    expect(scrubbed).not.toContain('a'.repeat(64));
    expect(scrubbed).toContain('[redacted-email]');
    expect(scrubbed).toContain('sha256=[redacted-signature]');
  });
});

// ── Unit Tests: Trace Record Builder ──────────────────────────────────────────

describe('buildNotificationDeliveryTrace (#1948)', () => {
  it('builds a valid pending trace record with redacted references', () => {
    const record = buildNotificationDeliveryTrace({
      outcome: 'pending',
      channel: 'EMAIL',
      lifecycleEvent: 'bounty_created',
      bountyId: 'BNT-0042',
      deliveryId: 'deliv-1',
      eventId: 'evt-1',
      cursor: 'cursor-token-999',
      recipientCount: 2,
    });

    expect(record).toMatchObject({
      event: NOTIFICATION_DELIVERY_EVENT,
      outcome: 'pending',
      channel: 'EMAIL',
      lifecycleEvent: 'bounty_created',
      bountyId: 'BNT-0042',
      deliveryRef: redactNotificationReference('deliv-1'),
      eventRef: redactNotificationReference('evt-1'),
      cursorRef: redactNotificationReference('cursor-token-999'),
      recipientCount: 2,
      statusCode: null,
      reason: null,
    });
    expect(record.at).toBeDefined();
    // Raw inputs must not be echoed
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('deliv-1');
    expect(serialized).not.toContain('evt-1');
    expect(serialized).not.toContain('cursor-token-999');
  });

  it('builds a committed trace record with status code', () => {
    const record = buildNotificationDeliveryTrace({
      outcome: 'committed',
      channel: 'WEBHOOK',
      lifecycleEvent: 'bounty_released',
      bountyId: '100',
      deliveryRef: 'sha256:1111222233334444',
      statusCode: 200,
    });

    expect(record.outcome).toBe('committed');
    expect(record.statusCode).toBe(200);
    expect(record.deliveryRef).toBe('sha256:1111222233334444');
  });

  it('builds a failed trace record with reason and scrubbed error message', () => {
    const record = buildNotificationDeliveryTrace({
      outcome: 'failed',
      channel: 'EMAIL',
      lifecycleEvent: 'bounty_reserved',
      bountyId: 'BNT-0042',
      statusCode: 429,
      reason: 'sendgrid_429',
      error: 'SendGrid responded 429 for user@example.com using SG.testkey',
    });

    expect(record.outcome).toBe('failed');
    expect(record.statusCode).toBe(429);
    expect(record.reason).toBe('sendgrid_429');
    expect(record.error).not.toContain('user@example.com');
    expect(record.error).not.toContain('SG.testkey');
    expect(record.error).toContain('[redacted-email]');
    expect(record.error).toContain('[redacted-sendgrid-key]');
  });

  it('throws an error for unrecognized trace outcome', () => {
    expect(() =>
      buildNotificationDeliveryTrace({
        outcome: 'in_doubt',
        channel: 'EMAIL',
      })
    ).toThrow(/unknown notification delivery trace outcome/);
  });
});

describe('createNotificationDeliveryTrace and console sink (#1948)', () => {
  it('requires a callable sink', () => {
    expect(() => createNotificationDeliveryTrace(null as any)).toThrow(
      /notification delivery trace sink must be a function/
    );
  });

  it('emits records to the provided sink', () => {
    const sinkRecords: NotificationDeliveryTraceRecord[] = [];
    const trace = createNotificationDeliveryTrace((rec) => sinkRecords.push(rec));

    trace.pending({ channel: 'EMAIL', lifecycleEvent: 'bounty_created' });
    trace.committed({ channel: 'EMAIL', lifecycleEvent: 'bounty_created', statusCode: 202 });
    trace.failed({ channel: 'EMAIL', lifecycleEvent: 'bounty_created', statusCode: 429, reason: 'sendgrid_429' });

    expect(sinkRecords).toHaveLength(3);
    expect(sinkRecords.map((r) => r.outcome)).toEqual(['pending', 'committed', 'failed']);
  });

  it('createConsoleNotificationDeliveryTrace writes prefixed single-line JSON', () => {
    const logSpy = vi.fn();
    const trace = createConsoleNotificationDeliveryTrace({ log: logSpy });

    trace.pending({ channel: 'WEBHOOK', lifecycleEvent: 'bounty_submitted', bountyId: 'BNT-1' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(/^\[NotificationWorker\]\[delivery-trace\] \{/);
    const parsed = JSON.parse(logSpy.mock.calls[0][0].replace('[NotificationWorker][delivery-trace] ', ''));
    expect(parsed.event).toBe(NOTIFICATION_DELIVERY_EVENT);
    expect(parsed.outcome).toBe('pending');
    expect(parsed.lifecycleEvent).toBe('bounty_submitted');
  });
});

// ── Integration Tests: sendNotification Delivery Outcomes & Tracing ──────────

describe('sendNotification — Delivery Worker Outcomes Tracing (#1948)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let traceRecords: NotificationDeliveryTraceRecord[] = [];

  beforeEach(() => {
    fetchMock.mockClear();
    traceRecords = [];
    vi.stubGlobal('fetch', fetchMock);
    clearNotificationOptIns();
    setGlobalNotificationDeliveryTraceSink((record) => traceRecords.push(record));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setGlobalNotificationDeliveryTraceSink(null);
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM_EMAIL;
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    delete process.env.NOTIFICATION_WEBHOOK_SECRET;
    delete process.env.NOTIFICATION_WEBHOOK_TIMEOUT_MS;
  });

  // ── Distinction: Pending event vs Committed transition ────────────────────

  it('operators can distinguish pending event from committed transition on successful delivery', async () => {
    fetchMock.mockResolvedValue(okResponse(202));
    process.env.NOTIFICATION_CHANNEL = 'EMAIL';
    process.env.SENDGRID_API_KEY = 'SG.valid-key';

    await sendNotification(RECIPIENTS, 'bounty_reserved', PAYLOAD, {
      deliveryId: 'deliv-test-success',
      cursor: 'cursor-ledger-100',
    });

    expect(traceRecords).toHaveLength(2);
    const [pending, committed] = traceRecords;

    // First record: pending before HTTP execution
    expect(pending.outcome).toBe(NOTIFICATION_DELIVERY_OUTCOMES.pending);
    expect(pending.lifecycleEvent).toBe('bounty_reserved');
    expect(pending.bountyId).toBe('BNT-0042');
    expect(pending.channel).toBe('EMAIL');
    expect(pending.deliveryRef).toBe(redactNotificationReference('deliv-test-success'));
    expect(pending.cursorRef).toBe(redactNotificationReference('cursor-ledger-100'));
    expect(pending.statusCode).toBeNull();

    // Second record: committed upon successful completion
    expect(committed.outcome).toBe(NOTIFICATION_DELIVERY_OUTCOMES.committed);
    expect(committed.lifecycleEvent).toBe('bounty_reserved');
    expect(committed.bountyId).toBe('BNT-0042');
    expect(committed.channel).toBe('EMAIL');
    expect(committed.deliveryRef).toBe(pending.deliveryRef);
    expect(committed.eventRef).toBe(pending.eventRef);
    expect(committed.cursorRef).toBe(pending.cursorRef);
    expect(committed.statusCode).toBe(202);
  });

  // ── SendGrid 429 Rate Limit Outcome ─────────────────────────────────────────

  it('records redacted event, delivery, and cursor reference on SendGrid 429', async () => {
    fetchMock.mockResolvedValue(
      errResponse(429, JSON.stringify({ errors: [{ message: 'Too Many Requests' }] }))
    );
    process.env.NOTIFICATION_CHANNEL = 'EMAIL';
    process.env.SENDGRID_API_KEY = 'SG.rate-limited-key';

    await sendNotification([RECIPIENTS[0]], 'bounty_submitted', PAYLOAD, {
      deliveryId: 'sg-429-deliv',
      eventId: 'sg-429-event',
      cursor: 'cursor-429-chk',
    });

    expect(traceRecords).toHaveLength(2);
    const [pending, failed] = traceRecords;

    expect(pending.outcome).toBe('pending');

    expect(failed.outcome).toBe('failed');
    expect(failed.channel).toBe('EMAIL');
    expect(failed.lifecycleEvent).toBe('bounty_submitted');
    expect(failed.bountyId).toBe('BNT-0042');
    expect(failed.reason).toBe('sendgrid_429');
    expect(failed.statusCode).toBe(429);

    // Correlated redacted references
    expect(failed.deliveryRef).toBe(redactNotificationReference('sg-429-deliv'));
    expect(failed.eventRef).toBe(redactNotificationReference('sg-429-event'));
    expect(failed.cursorRef).toBe(redactNotificationReference('cursor-429-chk'));
    expect(failed.deliveryRef).toBe(pending.deliveryRef);

    // Redaction verification: raw IDs and API key must never appear in record
    const serialized = JSON.stringify(failed);
    expect(serialized).not.toContain('sg-429-deliv');
    expect(serialized).not.toContain('sg-429-event');
    expect(serialized).not.toContain('cursor-429-chk');
    expect(serialized).not.toContain('rate-limited-key');
  });

  // ── Webhook Timeout Outcome ────────────────────────────────────────────────

  it('records redacted event, delivery, and cursor reference on webhook timeout (AbortSignal / TimeoutError)', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeoutError);

    process.env.NOTIFICATION_CHANNEL = 'WEBHOOK';
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://webhook.site/receiver';
    process.env.NOTIFICATION_WEBHOOK_SECRET = 'secret-wh-key-999';

    await sendNotification(RECIPIENTS, 'bounty_released', PAYLOAD, {
      deliveryId: 'wh-timeout-deliv-1',
      eventId: 'wh-timeout-evt-1',
      cursor: 'ledger-cursor-timeout',
      timeoutMs: 50,
    });

    expect(traceRecords).toHaveLength(2);
    const [pending, failed] = traceRecords;

    expect(pending.outcome).toBe('pending');
    expect(pending.channel).toBe('WEBHOOK');

    expect(failed.outcome).toBe('failed');
    expect(failed.channel).toBe('WEBHOOK');
    expect(failed.lifecycleEvent).toBe('bounty_released');
    expect(failed.bountyId).toBe('BNT-0042');
    expect(failed.reason).toBe('webhook_timeout');
    expect(failed.statusCode).toBe(504);

    // Correlated redacted references
    expect(failed.deliveryRef).toBe(redactNotificationReference('wh-timeout-deliv-1'));
    expect(failed.eventRef).toBe(redactNotificationReference('wh-timeout-evt-1'));
    expect(failed.cursorRef).toBe(redactNotificationReference('ledger-cursor-timeout'));
    expect(failed.deliveryRef).toBe(pending.deliveryRef);

    // Redaction: webhook secret, payload, and raw tokens must not leak
    const serialized = JSON.stringify(failed);
    expect(serialized).not.toContain('secret-wh-key-999');
    expect(serialized).not.toContain('wh-timeout-deliv-1');
    expect(serialized).not.toContain('ledger-cursor-timeout');
  });

  it('records redacted references on webhook 504 Gateway Timeout HTTP response', async () => {
    fetchMock.mockResolvedValue(errResponse(504, 'Gateway Timeout from reverse proxy'));

    process.env.NOTIFICATION_CHANNEL = 'WEBHOOK';
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://webhook.site/receiver';

    await sendNotification(RECIPIENTS, 'bounty_refunded', PAYLOAD, {
      deliveryId: 'deliv-gw-504',
      cursor: 'cursor-504',
    });

    expect(traceRecords).toHaveLength(2);
    const [, failed] = traceRecords;

    expect(failed.outcome).toBe('failed');
    expect(failed.channel).toBe('WEBHOOK');
    expect(failed.reason).toBe('webhook_timeout');
    expect(failed.statusCode).toBe(504);
    expect(failed.deliveryRef).toBe(redactNotificationReference('deliv-gw-504'));
    expect(failed.cursorRef).toBe(redactNotificationReference('cursor-504'));
  });

  // ── Lifecycle Transitions Coverage ─────────────────────────────────────────

  it('traces funding lifecycle transition: bounty_created', async () => {
    fetchMock.mockResolvedValue(okResponse(202));
    process.env.NOTIFICATION_CHANNEL = 'EMAIL';
    process.env.SENDGRID_API_KEY = 'SG.key';

    await sendNotification([RECIPIENTS[0]], 'bounty_created', {
      bountyId: 'BNT-CREATE',
      title: 'New escrow bounty',
      amount: 500,
      tokenSymbol: 'XLM',
    });

    expect(traceRecords).toHaveLength(2);
    expect(traceRecords[0].lifecycleEvent).toBe('bounty_created');
    expect(traceRecords[0].outcome).toBe('pending');
    expect(traceRecords[1].lifecycleEvent).toBe('bounty_created');
    expect(traceRecords[1].outcome).toBe('committed');
  });

  it('traces payout lifecycle transition: bounty_released and bounty_disputed', async () => {
    fetchMock.mockResolvedValue(okResponse(200));
    process.env.NOTIFICATION_CHANNEL = 'WEBHOOK';
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://webhook.example.com';

    await sendNotification(RECIPIENTS, 'bounty_disputed', {
      bountyId: 'BNT-DISPUTE',
      reason: 'Incomplete specifications',
    });

    expect(traceRecords).toHaveLength(2);
    expect(traceRecords[0].lifecycleEvent).toBe('bounty_disputed');
    expect(traceRecords[0].outcome).toBe('pending');
    expect(traceRecords[1].lifecycleEvent).toBe('bounty_disputed');
    expect(traceRecords[1].outcome).toBe('committed');
  });

  // ── Opt-out and Channel Invariance ─────────────────────────────────────────

  it('does not emit trace when user is opted out', async () => {
    setNotificationOptIn('optout@example.com', false);
    process.env.NOTIFICATION_CHANNEL = 'EMAIL';
    process.env.SENDGRID_API_KEY = 'SG.key';

    await sendNotification(
      [{ role: 'contributor', address: 'optout@example.com' }],
      'bounty_released',
      PAYLOAD
    );

    expect(traceRecords).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not emit trace when channel is unset', async () => {
    delete process.env.NOTIFICATION_CHANNEL;

    await sendNotification(RECIPIENTS, 'bounty_created', PAYLOAD);

    expect(traceRecords).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
