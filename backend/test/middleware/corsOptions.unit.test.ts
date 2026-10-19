import type { CorsOptions } from "cors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCorsOptions,
  createCorsPreflightGuard,
  isOriginAllowed,
  parseOriginAllowlist,
  resolveCorsConfig,
  warnIfProductionCorsMisconfigured,
} from "../../src/middleware/corsOptions";
import { mockNext, mockReq, mockRes, snapshotEnv } from "./helpers";

const ALLOWED = "https://app.example.com";
const restoreEnv = snapshotEnv("NODE_ENV", "ALLOWED_ORIGINS", "CORS_ORIGINS");

beforeEach(() => {
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.CORS_ORIGINS;
  process.env.NODE_ENV = "development";
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("parseOriginAllowlist", () => {
  it("splits, trims, and de-duplicates entries", () => {
    expect([...parseOriginAllowlist(" https://a.com ,https://b.com,https://a.com ")]).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it.each(["", " ", ",", " , , "])("returns an empty set for %j", (raw) => {
    expect(parseOriginAllowlist(raw).size).toBe(0);
  });

  it("does not normalise trailing slashes or treat * specially", () => {
    const set = parseOriginAllowlist("https://a.com/,*");
    expect(set.has("https://a.com")).toBe(false);
    expect(set.has("*")).toBe(true);
  });
});

describe("resolveCorsConfig", () => {
  it("production uses ALLOWED_ORIGINS only", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = ALLOWED;
    process.env.CORS_ORIGINS = "https://ignored.example.com";
    const config = resolveCorsConfig();
    expect(config.mode).toBe("production");
    expect([...(config.allowlist ?? [])]).toEqual([ALLOWED]);
  });

  it.each([undefined, "", "*"])("production with ALLOWED_ORIGINS=%j is an empty (strict) set, never permissive", (value) => {
    process.env.NODE_ENV = "production";
    if (value !== undefined) process.env.ALLOWED_ORIGINS = value;
    const config = resolveCorsConfig();
    expect(config.allowlist).not.toBeNull();
    expect(config.allowlist?.has("https://anything.example.com")).toBe(false);
  });

  it("development prefers CORS_ORIGINS over ALLOWED_ORIGINS", () => {
    process.env.CORS_ORIGINS = "https://dev.example.com";
    process.env.ALLOWED_ORIGINS = ALLOWED;
    expect([...(resolveCorsConfig().allowlist ?? [])]).toEqual(["https://dev.example.com"]);
  });

  it("development falls back to ALLOWED_ORIGINS", () => {
    process.env.ALLOWED_ORIGINS = ALLOWED;
    expect([...(resolveCorsConfig().allowlist ?? [])]).toEqual([ALLOWED]);
  });

  it.each([undefined, "", "  ", "*", " * "])("development with %j is permissive (null allowlist)", (value) => {
    if (value !== undefined) process.env.CORS_ORIGINS = value;
    expect(resolveCorsConfig()).toEqual({ mode: "development", allowlist: null });
  });

  it("treats test and unset NODE_ENV as development", () => {
    process.env.NODE_ENV = "test";
    expect(resolveCorsConfig().mode).toBe("development");
    delete process.env.NODE_ENV;
    expect(resolveCorsConfig().mode).toBe("development");
  });
});

describe("isOriginAllowed", () => {
  const strict = { mode: "production" as const, allowlist: new Set([ALLOWED]) };

  it("allows a missing or empty origin regardless of config", () => {
    expect(isOriginAllowed(undefined, strict)).toBe(true);
    expect(isOriginAllowed("", strict)).toBe(true);
  });

  it("allows any origin when the allowlist is null", () => {
    expect(isOriginAllowed("https://x.example.com", { mode: "development", allowlist: null })).toBe(true);
  });

  it("requires an exact match against the allowlist", () => {
    expect(isOriginAllowed(ALLOWED, strict)).toBe(true);
    expect(isOriginAllowed(`${ALLOWED}/`, strict)).toBe(false);
    expect(isOriginAllowed(ALLOWED.toUpperCase(), strict)).toBe(false);
    expect(isOriginAllowed("https://app.example.com.evil.com", strict)).toBe(false);
  });

  it("reads the environment when no config is passed", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = ALLOWED;
    expect(isOriginAllowed(ALLOWED)).toBe(true);
    expect(isOriginAllowed("https://other.example.com")).toBe(false);
  });
});

describe("warnIfProductionCorsMisconfigured", () => {
  it.each([undefined, "", "   "])("warns in production when ALLOWED_ORIGINS is %j", (value) => {
    process.env.NODE_ENV = "production";
    if (value !== undefined) process.env.ALLOWED_ORIGINS = value;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnIfProductionCorsMisconfigured();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/ALLOWED_ORIGINS is unset/);
  });

  it("stays silent in production with an allowlist, and outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = ALLOWED;
    warnIfProductionCorsMisconfigured();
    process.env.NODE_ENV = "development";
    delete process.env.ALLOWED_ORIGINS;
    warnIfProductionCorsMisconfigured();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("createCorsPreflightGuard", () => {
  function run(method: string, origin?: string) {
    const out = mockRes();
    const next = mockNext();
    createCorsPreflightGuard()(mockReq({ method, headers: { origin } }), out.res, next);
    return { ...out, next };
  }

  it("passes everything through outside production", () => {
    expect(run("OPTIONS", "https://evil.example.com").next).toHaveBeenCalledWith();
  });

  describe("in production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = ALLOWED;
    });

    it("rejects a preflight from a disallowed origin with 403", () => {
      const out = run("OPTIONS", "https://evil.example.com");
      expect(out.statusCode()).toBe(403);
      expect(out.body()).toEqual({ error: "Origin not allowed by CORS policy." });
      expect(out.next).not.toHaveBeenCalled();
    });

    it("allows a preflight from an allowed origin", () => {
      expect(run("OPTIONS", ALLOWED).next).toHaveBeenCalledWith();
    });

    it("allows a preflight with no Origin header", () => {
      expect(run("OPTIONS").next).toHaveBeenCalledWith();
    });

    it("does not block non-preflight requests from disallowed origins", () => {
      expect(run("GET", "https://evil.example.com").next).toHaveBeenCalledWith();
    });

    it("rejects every origin when ALLOWED_ORIGINS is unset", () => {
      delete process.env.ALLOWED_ORIGINS;
      expect(run("OPTIONS", ALLOWED).statusCode()).toBe(403);
    });

    it("re-reads the environment on every request", () => {
      const guard = createCorsPreflightGuard();
      process.env.ALLOWED_ORIGINS = "https://new.example.com";
      const out = mockRes();
      const next = mockNext();
      guard(mockReq({ method: "OPTIONS", headers: { origin: "https://new.example.com" } }), out.res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});

describe("buildCorsOptions", () => {
  function check(options: CorsOptions, origin: string | undefined) {
    const callback = vi.fn();
    (options.origin as (o: string | undefined, cb: typeof callback) => void)(origin, callback);
    return callback.mock.calls[0];
  }

  it("allows requests without an Origin", () => {
    process.env.NODE_ENV = "production";
    expect(check(buildCorsOptions(), undefined)).toEqual([null, true]);
  });

  it("allows listed origins and omits CORS for others without raising an error", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = ALLOWED;
    const options = buildCorsOptions();
    expect(check(options, ALLOWED)).toEqual([null, true]);
    expect(check(options, "https://evil.example.com")).toEqual([null, false]);
  });

  it("reflects any origin in permissive development mode", () => {
    expect(check(buildCorsOptions(), "https://anything.example.com")).toEqual([null, true]);
  });

  it("snapshots configuration at build time", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = ALLOWED;
    const options = buildCorsOptions();
    process.env.ALLOWED_ORIGINS = "https://later.example.com";
    expect(check(options, ALLOWED)).toEqual([null, true]);
    expect(check(options, "https://later.example.com")).toEqual([null, false]);
  });

  it("enables credentials and allows the headers the API relies on", () => {
    const options = buildCorsOptions();
    expect(options.credentials).toBe(true);
    expect(options.allowedHeaders).toEqual(
      expect.arrayContaining(["Content-Type", "X-Stellar-Signature", "X-Stellar-Public-Key", "Idempotency-Key"]),
    );
  });
});
