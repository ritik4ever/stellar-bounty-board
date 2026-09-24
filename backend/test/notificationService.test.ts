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
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
  });
});

// ── buildDiscordPayload ───────────────────────────────────────────────────────

describe("buildDiscordPayload", () => {
  const BOUNTY = {
    bountyId: "BNT-0001",
    title: "Fix the widget",
    amount: 100,
    tokenSymbol: "XLM",
    repo: "ritik4ever/stellar-stream",
    status: "open",
  };

  it("produces a valid Discord webhook embed schema", async () => {
    const { buildDiscordPayload } = await import("../src/services/notificationService");
    const payload = buildDiscordPayload(BOUNTY, "bounty_created");

    expect(payload).toHaveProperty("embeds");
    expect(Array.isArray(payload.embeds)).toBe(true);
    for (const embed of payload.embeds) {
      expect(typeof embed.title).toBe("string");
      expect(typeof embed.color).toBe("number");
      expect(Array.isArray(embed.fields)).toBe(true);
      for (const field of embed.fields) {
        expect(field).toHaveProperty("name");
        expect(field).toHaveProperty("value");
        expect(typeof field.inline).toBe("boolean");
      }
    }
  });

  it("includes bounty title, reward, repo link, and status as fields", async () => {
    const { buildDiscordPayload } = await import("../src/services/notificationService");
    const payload = buildDiscordPayload(BOUNTY, "bounty_created");
    const fields = payload.embeds[0].fields;

    expect(payload.embeds[0].title).toContain("Fix the widget");
    const reward = fields.find((f) => f.name === "Reward");
    const repoField = fields.find((f) => f.name === "Repository");
    const status = fields.find((f) => f.name === "Status");

    expect(reward?.value).toBe("100 XLM");
    expect(repoField?.value).toBe("https://github.com/ritik4ever/stellar-stream");
    expect(status?.value).toBe("open");
  });

  it("uses distinct colors per event type", async () => {
    const { buildDiscordPayload } = await import("../src/services/notificationService");
    const events = [
      "bounty_created",
      "bounty_reserved",
      "bounty_submitted",
      "bounty_released",
      "bounty_refunded",
      "bounty_disputed",
      "dispute_stuck_alert",
    ];
    const colors = events.map(
      (event) => buildDiscordPayload(BOUNTY, event).embeds[0].color,
    );

    expect(new Set(colors).size).toBe(events.length);
  });

  it("maps each event to a distinctly labeled title", async () => {
    const { buildDiscordPayload } = await import("../src/services/notificationService");
    const payload = buildDiscordPayload(BOUNTY, "bounty_released");
    expect(payload.embeds[0].title).toContain("Reward released");
  });

  it("falls back for unknown event types without throwing", async () => {
    const { buildDiscordPayload } = await import("../src/services/notificationService");
    const payload = buildDiscordPayload(BOUNTY, "bounty_alien_event");
    expect(payload.embeds[0].color).toBeTypeOf("number");
  });
});

// ── DISCORD channel ───────────────────────────────────────────────────────────

describe("sendNotification — DISCORD channel", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const DISCORD_URL = "https://discord.com/api/webhooks/1234/abc";

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.NOTIFICATION_CHANNEL = "DISCORD";
    process.env.DISCORD_WEBHOOK_URL = DISCORD_URL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  it("POSTs a Discord embed payload to DISCORD_WEBHOOK_URL", async () => {
    fetchMock.mockResolvedValue(okResponse(204));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DISCORD_URL);

    const body = JSON.parse(init?.body as string);
    expect(body.embeds).toHaveLength(1);
    const fields = body.embeds[0].fields.map((f: { name: string }) => f.name);
    expect(fields).toEqual(
      expect.arrayContaining(["Reward", "Repository", "Status", "Bounty ID"]),
    );
  });

  it("skips dispatch and logs warning when DISCORD_WEBHOOK_URL is absent", async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches and logs Discord errors without re-throwing", async () => {
    fetchMock.mockResolvedValue(errResponse(500, "Internal Server Error"));
    const { sendNotification } = await import("../src/services/notificationService");

    await expect(
      sendNotification(RECIPIENTS, "bounty_created", PAYLOAD),
    ).resolves.toBeUndefined();
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
