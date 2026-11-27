import crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

const RECIPIENTS = [
  { role: "maintainer", address: "maintainer@example.com" },
  { role: "contributor", address: "contributor@example.com" },
];

const PAYLOAD = {
  bountyId: "BNT-0001",
  title: "Fix the widget",
  amount: 100,
  tokenSymbol: "XLM",
};

function okResponse(status = 202): Response {
  return new Response(null, { status });
}

function errResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

// ── EMAIL channel ─────────────────────────────────────────────────────────────

describe("sendNotification — EMAIL channel", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.NOTIFICATION_CHANNEL = "EMAIL";
    process.env.SENDGRID_API_KEY = "SG.test-key";
    process.env.SENDGRID_FROM_EMAIL = "noreply@test.io";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM_EMAIL;
  });

  it("calls SendGrid API once per recipient", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(RECIPIENTS.length);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe("https://api.sendgrid.com/v3/mail/send");
    }
  });

  it("sets Authorization header with Bearer token", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_created", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer SG.test-key");
  });

  it("sends correct recipient address and from email in body", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_created", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.personalizations[0].to[0].email).toBe(RECIPIENTS[0].address);
    expect(body.from.email).toBe("noreply@test.io");
  });

  it("includes bountyId in email subject", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_reserved", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.subject).toContain("BNT-0001");
  });

  it("includes plain-text content block", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_submitted", {
      ...PAYLOAD,
      submissionUrl: "https://github.com/foo/bar/pull/1",
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.content[0].type).toBe("text/plain");
    expect(body.content[0].value).toContain("https://github.com/foo/bar/pull/1");
  });

  it("skips dispatch and logs warning when SENDGRID_API_KEY is absent", async () => {
    delete process.env.SENDGRID_API_KEY;
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches and logs SendGrid errors without re-throwing", async () => {
    fetchMock.mockResolvedValue(errResponse(500, "Internal Server Error"));
    const { sendNotification } = await import("../src/services/notificationService");

    // Should resolve without throwing
    await expect(
      sendNotification([RECIPIENTS[0]], "bounty_created", PAYLOAD),
    ).resolves.toMatchObject({
      channel: "EMAIL",
      outcomes: [expect.objectContaining({ status: "failed" })],
    });
  });

  it("uses default subject for unknown events", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_unknown_event", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.subject).toContain("bounty_unknown_event");
  });
});

// ── WEBHOOK channel ───────────────────────────────────────────────────────────

describe("sendNotification — WEBHOOK channel", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const WEBHOOK_URL = "https://hooks.example.com/bounty";
  const WEBHOOK_SECRET = "super-secret";

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.NOTIFICATION_CHANNEL = "WEBHOOK";
    process.env.NOTIFICATION_WEBHOOK_URL = WEBHOOK_URL;
    process.env.NOTIFICATION_WEBHOOK_SECRET = WEBHOOK_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    delete process.env.NOTIFICATION_WEBHOOK_SECRET;
  });

  it("POSTs to NOTIFICATION_WEBHOOK_URL", async () => {
    fetchMock.mockResolvedValue(okResponse(200));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_released", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK_URL);
  });

  it("sends event, payload, and recipients in body", async () => {
    fetchMock.mockResolvedValue(okResponse(200));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_released", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.event).toBe("bounty_released");
    expect(body.payload).toMatchObject(PAYLOAD);
    expect(body.recipients).toEqual(RECIPIENTS);
    expect(typeof body.timestamp).toBe("number");
  });

  it("attaches a valid HMAC-SHA256 signature header", async () => {
    fetchMock.mockResolvedValue(okResponse(200));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_released", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const rawBody = init?.body as string;
    const headers = init?.headers as Record<string, string>;
    const sigHeader = headers["X-Bounty-Signature"];

    expect(sigHeader).toMatch(/^sha256=/);

    const expected =
      "sha256=" +
      crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    expect(sigHeader).toBe(expected);
  });

  it("omits signature header when NOTIFICATION_WEBHOOK_SECRET is absent", async () => {
    delete process.env.NOTIFICATION_WEBHOOK_SECRET;
    fetchMock.mockResolvedValue(okResponse(200));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_released", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Bounty-Signature"]).toBeUndefined();
  });

  it("skips dispatch and logs warning when NOTIFICATION_WEBHOOK_URL is absent", async () => {
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_released", PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches and logs webhook errors without re-throwing", async () => {
    fetchMock.mockResolvedValue(errResponse(503, "Service Unavailable"));
    const { sendNotification } = await import("../src/services/notificationService");

    await expect(
      sendNotification(RECIPIENTS, "bounty_released", PAYLOAD),
    ).resolves.toMatchObject({
      channel: "WEBHOOK",
      outcomes: [
        expect.objectContaining({ status: "failed" }),
        expect.objectContaining({ status: "failed" }),
      ],
    });
  });
});

// ── No channel configured ─────────────────────────────────────────────────────

describe("sendNotification — no channel", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.NOTIFICATION_CHANNEL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op when NOTIFICATION_CHANNEL is unset", async () => {
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a no-op when NOTIFICATION_CHANNEL is an invalid value", async () => {
    process.env.NOTIFICATION_CHANNEL = "SMOKE_SIGNAL";
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.NOTIFICATION_CHANNEL;
  });
});

// ── Opt-out between enqueue and send ─────────────────────────────────────────

describe("sendNotification — opt-out boundary", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SENDGRID_API_KEY = "SG.test-key";
    process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.test/notify";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.NOTIFICATION_WEBHOOK_URL;
  });

  it("skips a recipient who opts out after an earlier send in the same batch", async () => {
    process.env.NOTIFICATION_CHANNEL = "EMAIL";
    const mod = await import("../src/services/notificationService");
    fetchMock.mockImplementationOnce(async () => {
      mod.setNotificationOptIn(RECIPIENTS[1].address, false);
      return okResponse();
    });
    fetchMock.mockResolvedValue(okResponse());

    const result = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.channel).toBe("EMAIL");
    expect(result.outcomes).toEqual([
      { address: RECIPIENTS[0].address, channel: "EMAIL", status: "sent" },
      { address: RECIPIENTS[1].address, channel: "EMAIL", status: "skipped", reason: "opted_out" },
    ]);
  });

  it("reports opted-out recipients as skipped without sending, keeping the channel", async () => {
    process.env.NOTIFICATION_CHANNEL = "EMAIL";
    const mod = await import("../src/services/notificationService");
    mod.setNotificationOptIn(RECIPIENTS[0].address, false);
    mod.setNotificationOptIn(RECIPIENTS[1].address, false);

    const result = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outcomes.every((o) => o.status === "skipped" && o.channel === "EMAIL")).toBe(true);
  });

  it("does not re-send to a recipient already alerted, and records failures per recipient", async () => {
    process.env.NOTIFICATION_CHANNEL = "EMAIL";
    const mod = await import("../src/services/notificationService");
    fetchMock.mockResolvedValueOnce(errResponse(500, "boom")).mockResolvedValue(okResponse());

    const result = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(RECIPIENTS.length);
    expect(result.outcomes.map((o) => o.status)).toEqual(["failed", "sent"]);
  });

  it("excludes opted-out recipients from the webhook body", async () => {
    process.env.NOTIFICATION_CHANNEL = "WEBHOOK";
    const mod = await import("../src/services/notificationService");
    mod.setNotificationOptIn(RECIPIENTS[1].address, false);
    fetchMock.mockResolvedValue(okResponse(200));

    const result = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody.recipients).toEqual([RECIPIENTS[0]]);
    expect(result.outcomes).toEqual([
      { address: RECIPIENTS[1].address, channel: "WEBHOOK", status: "skipped", reason: "opted_out" },
      { address: RECIPIENTS[0].address, channel: "WEBHOOK", status: "sent" },
    ]);
  });

  it("records per-recipient failure and preserves channel on SendGrid 429 rate limit", async () => {
    process.env.NOTIFICATION_CHANNEL = "EMAIL";
    const mod = await import("../src/services/notificationService");
    fetchMock.mockResolvedValueOnce(
      errResponse(429, JSON.stringify({ errors: [{ message: "Too many requests" }] }))
    );

    const result = await mod.sendNotification([RECIPIENTS[0]], "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.channel).toBe("EMAIL");
    expect(result.outcomes).toEqual([
      {
        address: RECIPIENTS[0].address,
        channel: "EMAIL",
        status: "failed",
        error: expect.stringContaining("SendGrid responded 429"),
      },
    ]);
  });

  it("records per-recipient failure and preserves channel on webhook timeout", async () => {
    process.env.NOTIFICATION_CHANNEL = "WEBHOOK";
    const mod = await import("../src/services/notificationService");
    fetchMock.mockRejectedValueOnce(new Error("The operation was aborted due to timeout"));

    const result = await mod.sendNotification(RECIPIENTS, "bounty_released", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.channel).toBe("WEBHOOK");
    expect(result.outcomes).toEqual([
      {
        address: RECIPIENTS[0].address,
        channel: "WEBHOOK",
        status: "failed",
        error: expect.stringMatching(/timeout|aborted/i),
      },
      {
        address: RECIPIENTS[1].address,
        channel: "WEBHOOK",
        status: "failed",
        error: expect.stringMatching(/timeout|aborted/i),
      },
    ]);
  });

  it("prevents duplicate alerts across worker restart and replay when recipient opts out after initial failure", async () => {
    process.env.NOTIFICATION_CHANNEL = "EMAIL";
    const mod = await import("../src/services/notificationService");

    // Pass 1: Recipient 0 succeeds, Recipient 1 fails with SendGrid 429
    fetchMock
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errResponse(429, "Too many requests"));

    const initialResult = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);
    expect(initialResult.channel).toBe("EMAIL");
    expect(initialResult.outcomes).toEqual([
      { address: RECIPIENTS[0].address, channel: "EMAIL", status: "sent" },
      {
        address: RECIPIENTS[1].address,
        channel: "EMAIL",
        status: "failed",
        error: expect.stringContaining("SendGrid responded 429"),
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Between passes: worker restarts, and recipient 1 opts out before replay
    fetchMock.mockClear();
    mod.setNotificationOptIn(RECIPIENTS[1].address, false);

    // Replay pass: remaining un-sent recipient 1 is skipped at the send boundary
    const replayResult = await mod.sendNotification([RECIPIENTS[1]], "bounty_created", PAYLOAD);
    expect(replayResult.channel).toBe("EMAIL");
    expect(replayResult.outcomes).toEqual([
      { address: RECIPIENTS[1].address, channel: "EMAIL", status: "skipped", reason: "opted_out" },
    ]);
    // SendGrid API not invoked for opted-out recipient; no duplicate alert sent
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles webhook restart and replay: excludes newly opted-out recipient and sends only to remaining", async () => {
    process.env.NOTIFICATION_CHANNEL = "WEBHOOK";
    const mod = await import("../src/services/notificationService");

    // Pass 1: Webhook encounters timeout
    fetchMock.mockRejectedValueOnce(new Error("The operation was aborted due to timeout"));
    const failResult = await mod.sendNotification(RECIPIENTS, "bounty_submitted", PAYLOAD);
    expect(failResult.outcomes.every((o) => o.status === "failed" && o.channel === "WEBHOOK")).toBe(true);

    // Recipient 0 opts out before worker replays
    fetchMock.mockClear();
    mod.setNotificationOptIn(RECIPIENTS[0].address, false);
    fetchMock.mockResolvedValueOnce(okResponse(200));

    // Pass 2 (Replay):
    const replayResult = await mod.sendNotification(RECIPIENTS, "bounty_submitted", PAYLOAD);
    expect(replayResult.channel).toBe("WEBHOOK");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody.recipients).toEqual([RECIPIENTS[1]]);
    expect(replayResult.outcomes).toEqual([
      { address: RECIPIENTS[0].address, channel: "WEBHOOK", status: "skipped", reason: "opted_out" },
      { address: RECIPIENTS[1].address, channel: "WEBHOOK", status: "sent" },
    ]);
  });
});

// ── Notification delivery worker resumption and retry safety (#1946) ───────────

describe("Notification delivery worker resumption and retry safety (#1946)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let tempJournalPath: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    tempJournalPath = path.join(os.tmpdir(), `notif-journal-${crypto.randomUUID()}.json`);
    process.env.NOTIFICATION_DELIVERY_STORE_PATH = tempJournalPath;
    process.env.NOTIFICATION_CHANNEL = "EMAIL";
    process.env.SENDGRID_API_KEY = "SG.test-key";
    process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.test/notify";
    vi.resetModules();
    const mod = await import("../src/services/notificationService");
    mod.clearNotificationDeliveryJournal();
    mod.clearNotificationOptIns();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    delete process.env.NOTIFICATION_DELIVERY_STORE_PATH;
    try {
      if (fs.existsSync(tempJournalPath)) {
        fs.unlinkSync(tempJournalPath);
      }
    } catch {}
  });

  it("reproduces SendGrid 429 interruption and safely resumes without duplicate alerts", async () => {
    const mod = await import("../src/services/notificationService");
    const deliveryRef = "bounty-created-batch-001";

    // Pass 1: Recipient 0 succeeds, Recipient 1 fails with SendGrid 429 rate limit
    fetchMock
      .mockResolvedValueOnce(okResponse(202))
      .mockResolvedValueOnce(errResponse(429, JSON.stringify({ errors: [{ message: "Too many requests" }] })));

    const pass1 = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD, { deliveryRef });
    expect(pass1.outcomes).toEqual([
      { address: RECIPIENTS[0].address, channel: "EMAIL", status: "sent" },
      {
        address: RECIPIENTS[1].address,
        channel: "EMAIL",
        status: "failed",
        error: expect.stringContaining("SendGrid responded 429"),
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Journal verifies delivery is left 'pending' for worker resumption
    const pendingList = mod.getPendingNotificationDeliveries();
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].deliveryId).toBe(deliveryRef);
    expect(pendingList[0].status).toBe("pending");
    expect(pendingList[0].attempts).toBe(1);

    // Pass 2: Resume worker ticks (e.g. at startup or cron worker retry)
    fetchMock.mockClear();
    // SendGrid rate limit clears: provider returns 202
    fetchMock.mockResolvedValueOnce(okResponse(202));

    const resumeSummary = await mod.resumePendingNotificationDeliveries();
    expect(resumeSummary).toEqual({
      resumed: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
    });

    // CRITICAL: SendGrid was called ONLY ONCE for recipient 1. Recipient 0 was NOT re-sent!
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Final journal state is completed
    const finalDelivery = mod.getNotificationDelivery(deliveryRef);
    expect(finalDelivery?.status).toBe("completed");
    expect(finalDelivery?.attempts).toBe(2);
    expect(finalDelivery?.outcomes).toEqual([
      { address: RECIPIENTS[0].address, channel: "EMAIL", status: "sent" },
      { address: RECIPIENTS[1].address, channel: "EMAIL", status: "sent" },
    ]);
  });

  it("reproduces webhook timeout and resumes safely, skipping users who opted out before replay", async () => {
    process.env.NOTIFICATION_CHANNEL = "WEBHOOK";
    const mod = await import("../src/services/notificationService");
    const deliveryRef = "bounty-released-webhook-002";

    // Pass 1: Webhook endpoint times out
    fetchMock.mockRejectedValueOnce(new Error("The operation was aborted due to timeout"));

    const pass1 = await mod.sendNotification(RECIPIENTS, "bounty_released", PAYLOAD, { deliveryRef });
    expect(pass1.outcomes.every((o) => o.status === "failed")).toBe(true);

    const pending = mod.getPendingNotificationDeliveries();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");

    // Between interruption and resume: Recipient 0 opts out
    mod.setNotificationOptIn(RECIPIENTS[0].address, false);

    // Pass 2: Resume pass
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(okResponse(200));

    const resumeSummary = await mod.resumePendingNotificationDeliveries();
    expect(resumeSummary).toEqual({
      resumed: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
    });

    // Webhook was called once with only the eligible recipient 1
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody.recipients).toEqual([RECIPIENTS[1]]);

    const finalDelivery = mod.getNotificationDelivery(deliveryRef);
    expect(finalDelivery?.status).toBe("completed");
    expect(finalDelivery?.outcomes).toEqual([
      { address: RECIPIENTS[0].address, channel: "WEBHOOK", status: "skipped", reason: "opted_out" },
      { address: RECIPIENTS[1].address, channel: "WEBHOOK", status: "sent" },
    ]);
  });

  it("persists interrupted delivery across simulated process crash and restart", async () => {
    const mod1 = await import("../src/services/notificationService");
    const deliveryRef = "crash-recovery-batch-003";

    // Recipient 0 succeeds, Recipient 1 fails with SendGrid 429
    fetchMock
      .mockResolvedValueOnce(okResponse(202))
      .mockResolvedValueOnce(errResponse(429, "Rate limited"));

    await mod1.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD, { deliveryRef });

    // Verify journal was persisted to disk
    expect(fs.existsSync(tempJournalPath)).toBe(true);

    // Simulate process crash and restart: reset modules and reload from disk
    vi.resetModules();
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(okResponse(202));

    const mod2 = await import("../src/services/notificationService");
    // Verify reload from disk found pending delivery
    expect(mod2.getPendingNotificationDeliveries()).toHaveLength(1);

    const resumeSummary = await mod2.resumePendingNotificationDeliveries();
    expect(resumeSummary.completed).toBe(1);
    expect(resumeSummary.remaining).toBe(0);

    // Recipient 0 was not re-sent; only recipient 1 was sent on restart
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never duplicates alerts when sendNotification is replayed with an already-completed deliveryRef", async () => {
    const mod = await import("../src/services/notificationService");
    const deliveryRef = "already-completed-batch-004";

    fetchMock.mockResolvedValue(okResponse(202));

    // First call commits
    const firstResult = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD, { deliveryRef });
    expect(firstResult.outcomes.every((o) => o.status === "sent")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call with same deliveryRef returns committed result with 0 provider calls
    fetchMock.mockClear();
    const replayResult = await mod.sendNotification(RECIPIENTS, "bounty_created", PAYLOAD, { deliveryRef });
    expect(replayResult.outcomes).toEqual(firstResult.outcomes);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
