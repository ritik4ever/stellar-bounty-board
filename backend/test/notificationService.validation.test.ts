import crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Focused tests for the notification delivery worker trust boundary (#1947).
 * Every external call is stubbed; no live SendGrid, webhook, or filesystem
 * outside os.tmpdir() is touched.
 */

const RECIPIENTS = [
  { role: 'maintainer', address: 'maintainer@example.com' },
  { role: 'contributor', address: 'contributor@example.com' },
];

const PAYLOAD = {
  bountyId: 'BNT-0001',
  title: 'Fix the widget',
  amount: 100,
  tokenSymbol: 'XLM',
};

function okResponse(status = 202): Response {
  return new Response(null, { status });
}

describe('notificationService validation — trust boundary (#1947)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let tempJournalPath: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    tempJournalPath = path.join(os.tmpdir(), `notif-valid-${crypto.randomUUID()}.json`);
    process.env.NOTIFICATION_DELIVERY_STORE_PATH = tempJournalPath;
    process.env.NOTIFICATION_CHANNEL = 'EMAIL';
    process.env.SENDGRID_API_KEY = 'SG.test-key';
    vi.resetModules();
    const mod = await import('../src/services/notificationService');
    mod.clearNotificationDeliveryJournal();
    mod.clearNotificationOptIns();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    delete process.env.NOTIFICATION_WEBHOOK_SECRET;
    delete process.env.NOTIFICATION_DELIVERY_STORE_PATH;
    delete process.env.NOTIFICATION_TIMEOUT_MS;
    try {
      if (fs.existsSync(tempJournalPath)) fs.unlinkSync(tempJournalPath);
    } catch {}
  });

  // ── Accept existing shape (regression) ────────────────────────────────────

  it('accepts well-formed input unchanged and dispatches normally', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(RECIPIENTS, 'bounty_created', PAYLOAD);

    expect(result.channel).toBe('EMAIL');
    expect(result.outcomes.every((o) => o.status === 'sent')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(RECIPIENTS.length);
  });

  it('accepts a forward-compatible event name that is not in NOTIFICATION_LIFECYCLE_TRANSITIONS', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(
      [RECIPIENTS[0]],
      'dispute_stuck_alert',
      { ...PAYLOAD, hoursDisputed: 48 },
    );

    expect(result.outcomes[0].status).toBe('sent');
  });

  // ── Recipient shape ───────────────────────────────────────────────────────

  it('rejects a recipient with an empty address before dispatch', async () => {
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(
      [{ role: 'maintainer', address: '   ' }],
      'bounty_created',
      PAYLOAD,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      expect.objectContaining({ status: 'failed', error: 'invalid_input' }),
    ]);
  });

  it('rejects a recipient whose address contains control characters (CRLF header injection guard)', async () => {
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(
      [{ role: 'maintainer', address: 'attacker@example.com\r\nBcc: victim@example.com' }],
      'bounty_created',
      PAYLOAD,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', error: 'invalid_input' });
  });

  it('rejects a recipient with an invalid role alphabet', async () => {
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(
      [{ role: 'maintainer\r\nX-Injected: 1', address: 'a@b.test' }],
      'bounty_created',
      PAYLOAD,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', error: 'invalid_input' });
  });

  it('rejects an empty recipients array', async () => {
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification([], 'bounty_created', PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      expect.objectContaining({ status: 'failed', error: 'invalid_input' }),
    ]);
  });

  // ── Event shape ───────────────────────────────────────────────────────────

  it('rejects an event name containing CRLF', async () => {
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(
      [RECIPIENTS[0]],
      'bounty_created\r\nBcc: x@y.test',
      PAYLOAD,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', error: 'invalid_input' });
  });

  it('rejects an event name starting with a non-letter', async () => {
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification([RECIPIENTS[0]], '123-event', PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', error: 'invalid_input' });
  });

  // ── Payload shape ─────────────────────────────────────────────────────────

  it('rejects an oversized payload (>64 KiB serialized)', async () => {
    const mod = await import('../src/services/notificationService');

    const huge = { bountyId: 'BNT-1', title: 'x'.repeat(80 * 1024) };
    const result = await mod.sendNotification([RECIPIENTS[0]], 'bounty_created', huge);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', error: 'invalid_input' });
  });

  it('sanitizes CRLF in the payload title when building the email subject', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const mod = await import('../src/services/notificationService');

    await mod.sendNotification(
      [RECIPIENTS[0]],
      'bounty_created',
      { ...PAYLOAD, title: 'Legit title\r\nBcc: evil@example.com' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.subject).not.toMatch(/[\r\n]/);
    expect(body.subject).toContain('Legit title');
  });

  // ── deliveryRef shape ─────────────────────────────────────────────────────

  it('rejects a malformed deliveryRef without writing a journal entry', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(
      [RECIPIENTS[0]],
      'bounty_created',
      PAYLOAD,
      { deliveryRef: 'bad ref with spaces!' },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', error: 'invalid_input' });
    expect(mod.getPendingNotificationDeliveries()).toEqual([]);
  });

  it('accepts deliveryRef with dots, colons, and hyphens', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(
      [RECIPIENTS[0]],
      'bounty_created',
      PAYLOAD,
      { deliveryRef: 'urn:bounty.v1:batch-42' },
    );

    expect(result.outcomes[0].status).toBe('sent');
  });

  // ── Webhook URL validation ────────────────────────────────────────────────

  it('rejects a plaintext http webhook URL and skips dispatch', async () => {
    process.env.NOTIFICATION_CHANNEL = 'WEBHOOK';
    process.env.NOTIFICATION_WEBHOOK_URL = 'http://internal.metadata/hook';
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(RECIPIENTS, 'bounty_released', PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      result.outcomes.every(
        (o) => o.status === 'skipped' && o.reason === 'not_configured',
      ),
    ).toBe(true);
  });

  it('rejects a non-URL webhook target and skips dispatch', async () => {
    process.env.NOTIFICATION_CHANNEL = 'WEBHOOK';
    process.env.NOTIFICATION_WEBHOOK_URL = 'not-a-url';
    const mod = await import('../src/services/notificationService');

    const result = await mod.sendNotification(RECIPIENTS, 'bounty_released', PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      result.outcomes.every(
        (o) => o.status === 'skipped' && o.reason === 'not_configured',
      ),
    ).toBe(true);
  });

  // ── Journal replay trust boundary ─────────────────────────────────────────

  it('skips a tampered journal entry without dispatching or mutating it', async () => {
    // Seed a valid pending entry.
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    const mod = await import('../src/services/notificationService');
    await mod.sendNotification(RECIPIENTS, 'bounty_created', PAYLOAD, {
      deliveryRef: 'tamper-target-1',
    });
    expect(mod.getPendingNotificationDeliveries()).toHaveLength(1);

    // Tamper: replace the stored entry with a malformed one (bad event + bad recipient).
    const raw = JSON.parse(fs.readFileSync(tempJournalPath, 'utf-8'));
    raw['tamper-target-1'].event = 'bad event\r\nBcc: x';
    raw['tamper-target-1'].recipients = [{ role: 'maintainer', address: '' }];
    fs.writeFileSync(tempJournalPath, JSON.stringify(raw));

    fetchMock.mockClear();
    const summary = await mod.resumePendingNotificationDeliveries();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBe(0);
  });

  it('replays a valid pending entry normally', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    const mod = await import('../src/services/notificationService');
    await mod.sendNotification(RECIPIENTS, 'bounty_created', PAYLOAD, {
      deliveryRef: 'valid-replay-1',
    });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(okResponse());
    const summary = await mod.resumePendingNotificationDeliveries();

    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
  });
});
