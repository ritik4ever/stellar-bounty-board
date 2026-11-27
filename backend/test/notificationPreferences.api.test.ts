import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import * as notificationService from '../src/services/notificationService';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  process.env.NOTIFICATION_CHANNEL = 'EMAIL';
  process.env.SENDGRID_API_KEY = 'SG.test-key';
  process.env.NOTIFICATION_DELIVERY_STORE_PATH = path.join(
    os.tmpdir(),
    `notification-preferences-${randomUUID()}.json`
  );
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  notificationService.clearNotificationOptIns();
  notificationService.clearNotificationDeliveryJournal();
});

afterEach(() => {
  notificationService.clearNotificationOptIns();
  notificationService.clearNotificationDeliveryJournal();
  vi.unstubAllGlobals();
  delete process.env.NOTIFICATION_CHANNEL;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.NOTIFICATION_DELIVERY_STORE_PATH;
});

describe('notification preference routes', () => {
  it('updates the same address twice and returns its latest stored channel preference', async () => {
    const address = 'GTESTCONTRIBUTOR';
    const email = 'contributor@example.test';

    const optedIn = await request(app)
      .post('/api/notifications/opt-in')
      .send({ address, optIn: true, email })
      .expect(200);
    expect(optedIn.body.data).toMatchObject({ address, optIn: true, email });
    expect(typeof optedIn.body.data.updatedAt).toBe('number');

    const optedOut = await request(app)
      .post('/api/notifications/opt-in')
      .send({ address, optIn: false, email })
      .expect(200);
    expect(optedOut.body.data).toMatchObject({ address, optIn: false, email });
    expect(typeof optedOut.body.data.updatedAt).toBe('number');

    const preference = await request(app)
      .get(`/api/notification-preferences/${address}`)
      .expect(200);
    expect(Object.keys(preference.body)).toEqual(['data']);
    expect(preference.body.data).toMatchObject({
      address,
      optedIn: false,
      channels: { email: true, webhook: false, push: true },
      preference: { address, optIn: false, email },
    });
    expect(preference.body.data.supportedTransitions).toEqual(
      notificationService.NOTIFICATION_LIFECYCLE_TRANSITIONS
    );
    expect(
      Object.values(preference.body.data.events).every((enabled: unknown) => enabled === false)
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a queued recipient who opts out through the API and does not replay a completed delivery', async () => {
    const first = { address: 'GTESTFIRST', role: 'maintainer' };
    const queued = { address: 'GTESTQUEUED', role: 'contributor' };
    const firstEmail = 'maintainer@example.test';
    const queuedEmail = 'contributor@example.test';

    for (const [recipient, email] of [
      [first, firstEmail],
      [queued, queuedEmail],
    ] as const) {
      await request(app)
        .post('/api/notifications/opt-in')
        .send({ address: recipient.address, optIn: true, email })
        .expect(200);
    }

    let preferenceResponseStatus: number | undefined;
    let preferenceResponseData: unknown;
    fetchMock.mockImplementationOnce(async (_input, init) => {
      const preferenceResponse = await request(app)
        .post('/api/notifications/opt-in')
        .send({ address: queued.address, optIn: false, email: queuedEmail });
      preferenceResponseStatus = preferenceResponse.status;
      preferenceResponseData = preferenceResponse.body.data;
      return new Response(null, { status: 202 });
    });

    const deliveryRef = 'notification-preference-race-1';
    const send = () =>
      notificationService.sendNotification(
        [first, queued],
        'bounty_created',
        { bountyId: 'BNT-1' },
        { deliveryRef }
      );

    const result = await send();
    expect(preferenceResponseStatus).toBe(200);
    expect(preferenceResponseData).toMatchObject({
      address: queued.address,
      optIn: false,
      email: queuedEmail,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).personalizations[0].to).toEqual([
      { email: firstEmail },
    ]);
    expect(result.outcomes).toEqual([
      { address: first.address, channel: 'EMAIL', status: 'sent' },
      {
        address: queued.address,
        channel: 'EMAIL',
        status: 'skipped',
        reason: 'opted_out',
      },
    ]);

    const queuedPreference = await request(app)
      .get(`/api/notification-preferences/${queued.address}`)
      .expect(200);
    expect(queuedPreference.body.data).toMatchObject({
      address: queued.address,
      optedIn: false,
      channels: { email: true, webhook: false, push: true },
      preference: { address: queued.address, optIn: false, email: queuedEmail },
    });

    await expect(send()).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
