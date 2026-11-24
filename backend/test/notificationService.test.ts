import crypto from "node:crypto";
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
