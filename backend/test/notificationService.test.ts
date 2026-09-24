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

function okResponse(status = 200): Response {
  return new Response(null, { status });
}

function errResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

// ── buildSlackPayload ─────────────────────────────────────────────────────────

describe("buildSlackPayload", () => {
  beforeEach(() => {
    delete process.env.FRONTEND_URL;
  });

  afterEach(() => {
    delete process.env.FRONTEND_URL;
  });

  it("builds Slack Block Kit payload for created event with deep link and green styling", async () => {
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const bounty = {
      id: "BNT-100",
      title: "Add wallet connect",
      amount: 500,
      tokenSymbol: "USDC",
      repo: "stellar/bounty-board",
      summary: "Integrate Freighter wallet connector",
    };

    const payload = buildSlackPayload(bounty, "bounty_created");

    expect(payload.text).toContain("New Bounty Created: Add wallet connect (500 USDC)");
    expect(payload.text).toContain("https://stellar-bounty-board.vercel.app/bounties/BNT-100");

    expect(payload.attachments).toHaveLength(1);
    const attachment = payload.attachments![0];
    expect(attachment.color).toBe("#2EB886");
    expect(attachment.blocks).toBeDefined();

    const [headerBlock, titleBlock, fieldsBlock, actionsBlock] = attachment.blocks!;

    expect(headerBlock).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "✨ New Bounty Created", emoji: true },
    });

    expect(titleBlock).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("*<https://stellar-bounty-board.vercel.app/bounties/BNT-100|Add wallet connect>*"),
      },
    });

    expect(fieldsBlock.type).toBe("section");
    expect(fieldsBlock.fields).toEqual(
      expect.arrayContaining([
        { type: "mrkdwn", text: "*Amount:*\n500 USDC" },
        { type: "mrkdwn", text: "*Status:*\nopen" },
        { type: "mrkdwn", text: "*Bounty ID:*\n`BNT-100`" },
        { type: "mrkdwn", text: "*Repository:*\nstellar/bounty-board" },
      ]),
    );

    expect(actionsBlock).toMatchObject({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Bounty", emoji: true },
          url: "https://stellar-bounty-board.vercel.app/bounties/BNT-100",
          style: "primary",
        },
      ],
    });
  });

  it("builds distinct payload styling for reserved event (blue)", async () => {
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const bounty = {
      bountyId: "BNT-200",
      title: "Optimize indexer queries",
      amount: 300,
      tokenSymbol: "XLM",
      contributor: "GCONTRIBUTOR123",
    };

    const payload = buildSlackPayload(bounty, "reserved");

    expect(payload.attachments![0].color).toBe("#3AA3E3");
    const [headerBlock, , fieldsBlock] = payload.attachments![0].blocks!;
    expect(headerBlock.text?.text).toBe("🎯 Bounty Reserved");
    expect(fieldsBlock.fields).toEqual(
      expect.arrayContaining([
        { type: "mrkdwn", text: "*Amount:*\n300 XLM" },
        { type: "mrkdwn", text: "*Status:*\nreserved" },
        { type: "mrkdwn", text: "*Contributor:*\n`GCONTRIBUTOR123`" },
      ]),
    );
  });

  it("builds distinct payload styling for disputed event (red with danger button)", async () => {
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const bounty = {
      id: "BNT-300",
      title: "Deploy Soroban contract",
      amount: 1000,
      tokenSymbol: "USDC",
      reason: "Submission does not match specs",
    };

    const payload = buildSlackPayload(bounty, "bounty_disputed");

    expect(payload.attachments![0].color).toBe("#E01E5A");
    const [headerBlock, , fieldsBlock, actionsBlock] = payload.attachments![0].blocks!;
    expect(headerBlock.text?.text).toBe("⚠️ Bounty Disputed");
    expect(fieldsBlock.fields).toEqual(
      expect.arrayContaining([
        { type: "mrkdwn", text: "*Status:*\ndisputed" },
        { type: "mrkdwn", text: "*Reason:*\nSubmission does not match specs" },
      ]),
    );
    expect(actionsBlock.elements![0].style).toBe("danger");
  });

  it("builds distinct payload styling for released event (green)", async () => {
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const bounty = {
      id: "BNT-400",
      title: "UI Dark Mode",
      amount: 200,
      tokenSymbol: "XLM",
      status: "released",
    };

    const payload = buildSlackPayload(bounty, "bounty_released");

    expect(payload.attachments![0].color).toBe("#2EB886");
    const [headerBlock, , fieldsBlock] = payload.attachments![0].blocks!;
    expect(headerBlock.text?.text).toBe("🎉 Bounty Reward Released");
    expect(fieldsBlock.fields).toEqual(
      expect.arrayContaining([
        { type: "mrkdwn", text: "*Status:*\nreleased" },
      ]),
    );
  });

  it("builds distinct payload styling for submitted event (purple)", async () => {
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const payload = buildSlackPayload(PAYLOAD, "bounty_submitted");

    expect(payload.attachments![0].color).toBe("#8957E5");
    expect(payload.attachments![0].blocks![0].text?.text).toBe("📝 Solution Submitted");
  });

  it("builds distinct payload styling for refunded event (orange)", async () => {
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const payload = buildSlackPayload(PAYLOAD, "bounty_refunded");

    expect(payload.attachments![0].color).toBe("#E8912D");
    expect(payload.attachments![0].blocks![0].text?.text).toBe("↩️ Bounty Refunded");
  });

  it("respects custom FRONTEND_URL environment variable", async () => {
    process.env.FRONTEND_URL = "https://app.custom-domain.org/";
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const payload = buildSlackPayload({ id: "BNT-999", title: "Test" }, "created");

    expect(payload.text).toContain("https://app.custom-domain.org/bounties/BNT-999");
    expect(payload.attachments![0].blocks![3].elements![0].url).toBe(
      "https://app.custom-domain.org/bounties/BNT-999",
    );
  });

  it("handles empty / partial bounty objects gracefully", async () => {
    const { buildSlackPayload } = await import("../src/services/notificationService");

    const payload = buildSlackPayload({}, "unknown_event");

    expect(payload.attachments![0].color).toBe("#4A154B");
    expect(payload.attachments![0].blocks![0].text?.text).toBe("📢 Bounty Event: unknown_event");
    expect(payload.attachments![0].blocks![1].text?.text).toBe(
      "*<https://stellar-bounty-board.vercel.app|Untitled Bounty>*",
    );
  });
});

// ── SLACK channel ─────────────────────────────────────────────────────────────

describe("sendNotification — SLACK channel", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T00/B00/XXXX";

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.NOTIFICATION_CHANNEL = "SLACK";
    process.env.SLACK_WEBHOOK_URL = SLACK_WEBHOOK_URL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_CHANNEL;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("POSTs Block Kit payload to SLACK_WEBHOOK_URL", async () => {
    fetchMock.mockResolvedValue(okResponse(200));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SLACK_WEBHOOK_URL);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain("New Bounty Created");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].blocks).toBeDefined();
  });

  it("skips dispatch and logs warning when SLACK_WEBHOOK_URL is absent", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches and logs slack webhook errors without re-throwing", async () => {
    fetchMock.mockResolvedValue(errResponse(500, "Internal Server Error"));
    const { sendNotification } = await import("../src/services/notificationService");

    await expect(
      sendNotification(RECIPIENTS, "bounty_created", PAYLOAD),
    ).resolves.toBeUndefined();
  });
});

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
    fetchMock.mockResolvedValue(okResponse(202));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification(RECIPIENTS, "bounty_created", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(RECIPIENTS.length);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe("https://api.sendgrid.com/v3/mail/send");
    }
  });

  it("sets Authorization header with Bearer token", async () => {
    fetchMock.mockResolvedValue(okResponse(202));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_created", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer SG.test-key");
  });

  it("sends correct recipient address and from email in body", async () => {
    fetchMock.mockResolvedValue(okResponse(202));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_created", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.personalizations[0].to[0].email).toBe(RECIPIENTS[0].address);
    expect(body.from.email).toBe("noreply@test.io");
  });

  it("includes bountyId in email subject", async () => {
    fetchMock.mockResolvedValue(okResponse(202));
    const { sendNotification } = await import("../src/services/notificationService");

    await sendNotification([RECIPIENTS[0]], "bounty_reserved", PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.subject).toContain("BNT-0001");
  });

  it("includes plain-text content block", async () => {
    fetchMock.mockResolvedValue(okResponse(202));
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
    fetchMock.mockResolvedValue(okResponse(202));
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
