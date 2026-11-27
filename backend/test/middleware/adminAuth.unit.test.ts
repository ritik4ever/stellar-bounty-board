import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminApiKeyAuthMiddleware } from "../../src/middleware/adminAuth";
import { MiddlewareDependencyError } from "../../src/middleware/errors";
import { mockNext, mockReq, mockRes, snapshotEnv } from "./helpers";

const KEY = "admin-key-for-unit-tests";
let hash: string;
const restoreEnv = snapshotEnv("NODE_ENV", "ADMIN_API_KEY_HASH");

beforeAll(async () => {
  hash = await bcrypt.hash(KEY, 4);
});

beforeEach(() => {
  process.env.NODE_ENV = "production";
  process.env.ADMIN_API_KEY_HASH = hash;
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

async function run(key?: string) {
  const out = mockRes();
  const next = mockNext();
  await createAdminApiKeyAuthMiddleware()(
    mockReq({ headers: key === undefined ? {} : { "x-admin-api-key": key } }),
    out.res,
    next,
  );
  return { ...out, next };
}

describe("createAdminApiKeyAuthMiddleware", () => {
  it("calls next() with no checks when NODE_ENV is test", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.ADMIN_API_KEY_HASH;
    const out = await run();
    expect(out.next).toHaveBeenCalledWith();
  });

  it("calls next() for the correct key", async () => {
    const out = await run(KEY);
    expect(out.next).toHaveBeenCalledWith();
    expect(out.res.status).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("returns 500 when ADMIN_API_KEY_HASH is %j", async (value) => {
    if (value === undefined) delete process.env.ADMIN_API_KEY_HASH;
    else process.env.ADMIN_API_KEY_HASH = value;
    const out = await run(KEY);
    expect(out.statusCode()).toBe(500);
    expect(out.body()).toEqual({ error: "Admin API key is not configured on this server." });
    expect(out.next).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("returns 401 when the header is %j", async (key) => {
    const out = await run(key);
    expect(out.statusCode()).toBe(401);
    expect(out.body()).toEqual({ error: "Missing x-admin-api-key header." });
  });

  it.each([
    ["a wrong key", "wrong"],
    ["the key with a trailing space", `${KEY} `],
    ["the key with different case", KEY.toUpperCase()],
    ["the hash itself", "HASH"],
  ])("returns 401 for %s", async (_label, key) => {
    const out = await run(key === "HASH" ? hash : key);
    expect(out.statusCode()).toBe(401);
    expect(out.body()).toEqual({ error: "Invalid admin API key." });
    expect(out.next).not.toHaveBeenCalled();
  });

  it("returns 401 (not an error) for a malformed stored hash that bcrypt rejects as a mismatch", async () => {
    process.env.ADMIN_API_KEY_HASH = "not-a-bcrypt-hash";
    const out = await run(KEY);
    expect(out.statusCode()).toBe(401);
  });

  it("forwards a bcrypt failure to next() as a MiddlewareDependencyError without responding", async () => {
    const cause = new Error("bcrypt internal failure");
    vi.spyOn(bcrypt, "compare").mockRejectedValue(cause as never);
    const out = await run(KEY);

    expect(out.res.status).not.toHaveBeenCalled();
    expect(out.next).toHaveBeenCalledTimes(1);
    const err = out.next.mock.calls[0][0] as MiddlewareDependencyError;
    expect(err).toBeInstanceOf(MiddlewareDependencyError);
    expect(err).toMatchObject({
      operation: "admin_api_key.compare",
      dependency: "bcrypt",
      statusCode: 500,
      publicMessage: "Failed to verify admin API key.",
    });
    expect(err.cause).toBe(cause);
  });

  it("reads the hash on every request, so rotation needs no restart", async () => {
    const middleware = createAdminApiKeyAuthMiddleware();
    process.env.ADMIN_API_KEY_HASH = await bcrypt.hash("rotated", 4);
    const out = mockRes();
    const next = mockNext();
    await middleware(mockReq({ headers: { "x-admin-api-key": "rotated" } }), out.res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
