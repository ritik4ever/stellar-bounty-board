import { Keypair } from "@stellar/stellar-sdk";
import type { RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockNext, mockReq, mockRes, snapshotEnv } from "./helpers";

const maintainerKeys = Keypair.random();
const otherKeys = Keypair.random();
const NOW_MS = 1_900_000_000_000;
const NOW_S = NOW_MS / 1000;

const restoreEnv = snapshotEnv("NODE_ENV", "MAINTAINER_PUBLIC_KEY", "MAINTAINER_PUBLIC_KEYS");

beforeEach(() => {
  process.env.NODE_ENV = "production";
  delete process.env.MAINTAINER_PUBLIC_KEYS;
  process.env.MAINTAINER_PUBLIC_KEY = maintainerKeys.publicKey();
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
  // Fresh module per test so the module-level replay cache starts empty.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv();
});

async function loadAuth() {
  return import("../../src/middleware/auth");
}

function run(middleware: RequestHandler, req: ReturnType<typeof mockReq>) {
  const response = mockRes();
  const next = mockNext();
  // The middleware is synchronous and documented never to throw.
  expect(() => middleware(req, response.res, next)).not.toThrow();
  return { ...response, next };
}

describe("createBountyCreationSignatureMiddleware", () => {
  const body = {
    repo: "owner/repo",
    issueNumber: 7,
    amount: 50,
    tokenSymbol: "XLM",
    deadlineDays: 14,
    title: "ignored by signature",
    maintainer: maintainerKeys.publicKey(),
  };

  function canonical(b: typeof body) {
    return Buffer.from(
      JSON.stringify({
        repo: b.repo,
        issueNumber: b.issueNumber,
        amount: b.amount,
        tokenSymbol: b.tokenSymbol,
        deadline: b.deadlineDays,
      }),
      "utf8",
    );
  }

  const base64Sig = maintainerKeys.sign(canonical(body)).toString("base64");
  const hexSig = maintainerKeys.sign(canonical(body)).toString("hex");

  it("calls next() without checks when NODE_ENV is test", async () => {
    process.env.NODE_ENV = "test";
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const { next, res } = run(createBountyCreationSignatureMiddleware(), mockReq({ body: {} }));
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["base64", base64Sig],
    ["hex", hexSig],
    ["0x-prefixed hex", `0x${hexSig}`],
    ["sig= prefixed base64", `sig=${base64Sig}`],
    ["signature= prefixed with whitespace", `  signature=${base64Sig}  `],
  ])("accepts a %s signature from the body's maintainer", async (_label, signature) => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const { next, res } = run(
      createBountyCreationSignatureMiddleware(),
      mockReq({ headers: { "x-stellar-signature": signature }, body }),
    );
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("uses the first value when the signature header is an array", async () => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const { next } = run(
      createBountyCreationSignatureMiddleware(),
      mockReq({ headers: { "x-stellar-signature": [base64Sig, "garbage"] }, body }),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 401 when the signature header is missing", async () => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const out = run(createBountyCreationSignatureMiddleware(), mockReq({ body }));
    expect(out.statusCode()).toBe(401);
    expect(out.body()).toEqual({ error: "Missing x-stellar-signature header." });
    expect(out.next).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["non-string", 12345],
    ["empty", ""],
  ])("returns 401 when maintainer is %s", async (_label, maintainer) => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const out = run(
      createBountyCreationSignatureMiddleware(),
      mockReq({ headers: { "x-stellar-signature": base64Sig }, body: { ...body, maintainer } }),
    );
    expect(out.statusCode()).toBe(401);
    expect(out.body()).toEqual({ error: "Missing maintainer field required for signature verification." });
    expect(out.next).not.toHaveBeenCalled();
  });

  it("returns 401 when the request body is absent", async () => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const out = run(
      createBountyCreationSignatureMiddleware(),
      mockReq({ headers: { "x-stellar-signature": base64Sig }, body: undefined }),
    );
    expect(out.statusCode()).toBe(401);
  });

  it.each([
    ["signed by a different key", otherKeys.sign(canonical(body)).toString("base64")],
    ["not a valid encoding", "%%%not-base64%%%"],
    ["empty after prefix removal", "0x"],
    ["truncated", base64Sig.slice(0, 20)],
  ])("returns 401 when the signature is %s", async (_label, signature) => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const out = run(
      createBountyCreationSignatureMiddleware(),
      mockReq({ headers: { "x-stellar-signature": signature }, body }),
    );
    expect(out.statusCode()).toBe(401);
    expect(out.body()).toEqual({
      error: "Invalid Stellar signature. Signer public key must match maintainer address.",
    });
  });

  it("returns 401 when a signed field is changed after signing", async () => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const out = run(
      createBountyCreationSignatureMiddleware(),
      mockReq({ headers: { "x-stellar-signature": base64Sig }, body: { ...body, amount: 5000 } }),
    );
    expect(out.statusCode()).toBe(401);
  });

  it("returns 401 (does not throw) when maintainer is not a valid Stellar key", async () => {
    const { createBountyCreationSignatureMiddleware } = await loadAuth();
    const out = run(
      createBountyCreationSignatureMiddleware(),
      mockReq({ headers: { "x-stellar-signature": base64Sig }, body: { ...body, maintainer: "GNOTAKEY" } }),
    );
    expect(out.statusCode()).toBe(401);
  });
});

describe("createStellarSignatureAuthMiddleware", () => {
  const BOUNTY_ID = "BNT-0001";

  function signedRequest(
    overrides: {
      body?: Record<string, unknown>;
      signer?: Keypair;
      publicKey?: string;
      params?: Record<string, string>;
      rawBody?: Buffer;
      signature?: string;
    } = {},
  ) {
    const body = overrides.body ?? { action: "release", bountyId: BOUNTY_ID, timestamp: NOW_S };
    const payload = overrides.rawBody ?? Buffer.from(JSON.stringify(body), "utf8");
    const signer = overrides.signer ?? maintainerKeys;
    return mockReq({
      headers: {
        "x-stellar-signature": overrides.signature ?? signer.sign(payload).toString("base64"),
        "x-stellar-public-key": overrides.publicKey ?? signer.publicKey(),
      },
      body,
      params: overrides.params ?? { id: BOUNTY_ID },
      rawBody: overrides.rawBody,
    });
  }

  async function middleware() {
    const { createStellarSignatureAuthMiddleware } = await loadAuth();
    return createStellarSignatureAuthMiddleware();
  }

  it("calls next() without checks when NODE_ENV is test", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.MAINTAINER_PUBLIC_KEY;
    const out = run(await middleware(), mockReq());
    expect(out.next).toHaveBeenCalledWith();
  });

  it("accepts a valid signed request and attaches signerPublicKey", async () => {
    const req = signedRequest();
    const out = run(await middleware(), req);
    expect(out.next).toHaveBeenCalledWith();
    expect(out.res.status).not.toHaveBeenCalled();
    expect(req.signerPublicKey).toBe(maintainerKeys.publicKey());
  });

  it("returns 500 when no maintainer keys are configured", async () => {
    delete process.env.MAINTAINER_PUBLIC_KEY;
    const out = run(await middleware(), signedRequest());
    expect(out.statusCode()).toBe(500);
    expect(out.body()).toEqual({ error: "Server maintainer public key configuration is missing." });
  });

  it("treats a blank/comma-only key list as unconfigured", async () => {
    process.env.MAINTAINER_PUBLIC_KEYS = " , ,";
    const out = run(await middleware(), signedRequest());
    expect(out.statusCode()).toBe(500);
  });

  it("prefers MAINTAINER_PUBLIC_KEYS (trimmed, comma-separated) over MAINTAINER_PUBLIC_KEY", async () => {
    process.env.MAINTAINER_PUBLIC_KEYS = ` ${otherKeys.publicKey()} , ${Keypair.random().publicKey()} `;
    const mw = await middleware();

    expect(run(mw, signedRequest({ signer: otherKeys })).next).toHaveBeenCalledWith();
    // MAINTAINER_PUBLIC_KEY is ignored once the list is set.
    expect(run(mw, signedRequest()).statusCode()).toBe(401);
  });

  it("reads the key configuration on every request", async () => {
    const mw = await middleware();
    process.env.MAINTAINER_PUBLIC_KEY = otherKeys.publicKey();
    expect(run(mw, signedRequest({ signer: otherKeys })).next).toHaveBeenCalledWith();
  });

  it.each([
    ["x-stellar-signature", "Missing x-stellar-signature header."],
    ["x-stellar-public-key", "Missing x-stellar-public-key header."],
  ])("returns 401 when the %s header is missing", async (header, message) => {
    const req = signedRequest();
    delete req.headers[header];
    const out = run(await middleware(), req);
    expect(out.statusCode()).toBe(401);
    expect(out.body()).toEqual({ error: message });
  });

  it("returns 401 for a public key that is not configured", async () => {
    const out = run(await middleware(), signedRequest({ signer: otherKeys }));
    expect(out.body()).toEqual({ error: "Unauthorized Stellar public key." });
  });

  it.each([
    ["missing action", { bountyId: BOUNTY_ID, timestamp: NOW_S }, "Invalid or missing action in request body."],
    ["non-string action", { action: 1, bountyId: BOUNTY_ID, timestamp: NOW_S }, "Invalid or missing action in request body."],
    ["missing bountyId", { action: "release", timestamp: NOW_S }, "Invalid or missing bountyId in request body."],
    ["non-string bountyId", { action: "release", bountyId: 1, timestamp: NOW_S }, "Invalid or missing bountyId in request body."],
    ["bountyId not matching the path", { action: "release", bountyId: "BNT-9999", timestamp: NOW_S }, "Request bountyId does not match the request path."],
    ["string timestamp", { action: "release", bountyId: BOUNTY_ID, timestamp: String(NOW_S) }, "Invalid or missing timestamp in request body."],
    ["missing timestamp", { action: "release", bountyId: BOUNTY_ID }, "Invalid or missing timestamp in request body."],
  ])("returns 401 for %s", async (_label, body, message) => {
    const out = run(await middleware(), signedRequest({ body }));
    expect(out.statusCode()).toBe(401);
    expect(out.body()).toEqual({ error: message });
    expect(out.next).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no body at all", async () => {
    const req = signedRequest();
    req.body = undefined;
    const out = run(await middleware(), req);
    expect(out.body()).toEqual({ error: "Invalid or missing action in request body." });
  });

  it.each([
    ["exactly 60s old", NOW_S - 60, true],
    ["exactly 60s in the future", NOW_S + 60, true],
    ["61s old", NOW_S - 61, false],
    ["61s in the future", NOW_S + 61, false],
  ])("timestamp %s → accepted: %s", async (_label, timestamp, accepted) => {
    const out = run(
      await middleware(),
      signedRequest({ body: { action: "release", bountyId: BOUNTY_ID, timestamp } }),
    );
    if (accepted) {
      expect(out.next).toHaveBeenCalledWith();
    } else {
      expect(out.body()).toEqual({ error: "Signature timestamp has expired or is invalid." });
    }
  });

  it("rejects a replayed signature within the 60s window", async () => {
    const mw = await middleware();
    const first = signedRequest();
    const signature = first.headers["x-stellar-signature"] as string;

    expect(run(mw, first).next).toHaveBeenCalledWith();

    const replay = run(mw, signedRequest({ signature }));
    expect(replay.body()).toEqual({ error: "Replay attack detected: signature already processed." });
    expect(replay.next).not.toHaveBeenCalled();
  });

  it("an old signature is still rejected after its nonce expires, by the timestamp check", async () => {
    const mw = await middleware();
    const first = signedRequest();
    run(mw, first);

    // The signature binds the timestamp, so once the nonce entry has expired
    // the timestamp window rejects the same signature instead.
    vi.mocked(Date.now).mockReturnValue(NOW_MS + 61_000);
    const later = run(mw, signedRequest({ signature: first.headers["x-stellar-signature"] as string }));
    expect(later.body()).toEqual({ error: "Signature timestamp has expired or is invalid." });

    // Fresh requests at the new time still succeed (expired entries are swept).
    const fresh = signedRequest({ body: { action: "release", bountyId: BOUNTY_ID, timestamp: NOW_S + 61 } });
    expect(run(mw, fresh).next).toHaveBeenCalledWith();
  });

  it("does not record a signature that failed verification", async () => {
    const mw = await middleware();
    const good = signedRequest();
    const signature = good.headers["x-stellar-signature"] as string;
    const tampered = signedRequest({
      body: { action: "refund", bountyId: BOUNTY_ID, timestamp: NOW_S },
      signature,
    });

    expect(run(mw, tampered).body()).toEqual({ error: "Invalid Stellar signature." });
    expect(run(mw, good).next).toHaveBeenCalledWith();
  });

  it("verifies against the raw body when present, not a re-serialisation", async () => {
    const body = { action: "release", bountyId: BOUNTY_ID, timestamp: NOW_S };
    const rawBody = Buffer.from(`{ "action": "release", "bountyId": "${BOUNTY_ID}", "timestamp": ${NOW_S} }`);
    const out = run(await middleware(), signedRequest({ body, rawBody }));
    expect(out.next).toHaveBeenCalledWith();

    // Same raw bytes but the signature was over JSON.stringify(body): rejected.
    const stringifySig = maintainerKeys.sign(Buffer.from(JSON.stringify(body))).toString("base64");
    const mismatch = run(await middleware(), signedRequest({ body, rawBody, signature: stringifySig }));
    expect(mismatch.body()).toEqual({ error: "Invalid Stellar signature." });
  });

  it("falls back to JSON.stringify(body) when rawBody is empty", async () => {
    const body = { action: "release", bountyId: BOUNTY_ID, timestamp: NOW_S };
    const req = signedRequest({ body });
    (req as unknown as { rawBody: Buffer }).rawBody = Buffer.alloc(0);
    expect(run(await middleware(), req).next).toHaveBeenCalledWith();
  });

  it("returns 401 (does not throw) for a malformed configured public key", async () => {
    process.env.MAINTAINER_PUBLIC_KEY = "GBADKEY";
    const out = run(await middleware(), signedRequest({ publicKey: "GBADKEY" }));
    expect(out.body()).toEqual({ error: "Invalid Stellar signature." });
  });

  it("returns 401 when body.maintainer differs from the signer, and burns the signature", async () => {
    const mw = await middleware();
    const body = {
      action: "release",
      bountyId: BOUNTY_ID,
      timestamp: NOW_S,
      maintainer: otherKeys.publicKey(),
    };
    const req = signedRequest({ body });
    const out = run(mw, req);
    expect(out.body()).toEqual({ error: "Request maintainer does not match signer public key." });
    expect(out.next).not.toHaveBeenCalled();

    const retry = run(mw, signedRequest({ body, signature: req.headers["x-stellar-signature"] as string }));
    expect(retry.body()).toEqual({ error: "Replay attack detected: signature already processed." });
  });

  it("accepts body.maintainer equal to the signer", async () => {
    const body = {
      action: "release",
      bountyId: BOUNTY_ID,
      timestamp: NOW_S,
      maintainer: maintainerKeys.publicKey(),
    };
    expect(run(await middleware(), signedRequest({ body })).next).toHaveBeenCalledWith();
  });

  it("shares the replay cache across middleware instances in one process", async () => {
    const { createStellarSignatureAuthMiddleware } = await loadAuth();
    const first = signedRequest();
    run(createStellarSignatureAuthMiddleware(), first);
    const replay = run(
      createStellarSignatureAuthMiddleware(),
      signedRequest({ signature: first.headers["x-stellar-signature"] as string }),
    );
    expect(replay.body()).toEqual({ error: "Replay attack detected: signature already processed." });
  });
});
