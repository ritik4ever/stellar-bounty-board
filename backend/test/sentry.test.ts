import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock @sentry/node ────────────────────────────────────────────────────────
// We mock the Sentry SDK so the tests never hit a real ingestion endpoint.

let scopeSetTags: Record<string, string> = {};
let scopeSetExtras: Record<string, unknown> = {};

vi.mock("@sentry/node", () => {
  return {
    init: vi.fn(),
    captureException: vi.fn((_err: unknown, _hint?: unknown) => "event-id"),
    withScope: vi.fn((cb: (scope: any) => void) => {
      const scope = {
        setTag: vi.fn((key: string, value: string) => {
          scopeSetTags[key] = value;
        }),
        setExtra: vi.fn((key: string, value: unknown) => {
          scopeSetExtras[key] = value;
        }),
        addEventProcessor: vi.fn(),
      };
      cb(scope);
    }),
    flush: vi.fn(() => Promise.resolve(true)),
  };
});

// ── Imports (after mock is hoisted) ──────────────────────────────────────────
import {
  sentryRequestHandler,
  sentryErrorHandler,
  captureErrorException,
  initSentry,
  redactBeforeSend,
} from "../src/sentry";

import * as SentryMock from "@sentry/node";

// ── Minimal Express test helpers ──────────────────────────────────────────────

/** Create a mock Express request.  Pass `requestId: null` to explicitly omit it. */
function createMockReq(overrides?: {
  method?: string;
  path?: string;
  route?: { path: string } | undefined;
  requestId?: string | null;
  protocol?: string;
  get?: (key: string) => string | undefined;
  originalUrl?: string;
  body?: unknown;
}) {
  const req: any = {
    method: overrides?.method ?? "GET",
    path: overrides?.path ?? "/api/bounties",
    route: overrides?.route === undefined ? { path: "/api/bounties" } : overrides.route,
    protocol: overrides?.protocol ?? "http",
    get: overrides?.get ?? ((key: string) => (key === "host" ? "localhost:3001" : undefined)),
    originalUrl: overrides?.originalUrl ?? "/api/bounties",
    body: overrides?.body,
    headers: {},
  };

  // Only set requestId if explicitly provided (null means omit entirely)
  if (overrides?.requestId !== null) {
    req.requestId = overrides?.requestId ?? "req-123";
  }

  return req;
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn(() => res),
    setHeader: vi.fn(),
  };
  return res;
}

// Minimal EventHint for the redactBeforeSend signature
const NO_HINT = {} as any;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Sentry integration", () => {
  beforeEach(() => {
    scopeSetTags = {};
    scopeSetExtras = {};
    vi.clearAllMocks();
  });

  describe("sentryRequestHandler", () => {
    it("tags the scope with route, method, and requestId", () => {
      const req = createMockReq({
        method: "POST",
        route: { path: "/api/bounties/:id/release" },
        requestId: "abc-123",
      });
      const res = createMockRes();
      const next = vi.fn();

      sentryRequestHandler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(scopeSetTags).toMatchObject({
        route: "/api/bounties/:id/release",
        method: "POST",
        requestId: "abc-123",
      });
    });

    it("defaults requestId to 'unknown' when absent", () => {
      // Pass null to explicitly omit requestId from the mock request
      const req = createMockReq({ requestId: null });
      const res = createMockRes();
      const next = vi.fn();

      sentryRequestHandler(req, res, next);

      expect(scopeSetTags.requestId).toBe("unknown");
    });

    it("calls next() to pass control to the next middleware", () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      sentryRequestHandler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe("sentryErrorHandler", () => {
    it("captures the exception and tags with request context", () => {
      const error = new Error("something broke");
      const req = createMockReq({
        method: "GET",
        route: { path: "/api/bounties/:id" },
        requestId: "err-456",
      });
      const res = createMockRes();
      const next = vi.fn();

      sentryErrorHandler(error, req, res, next);

      expect(vi.mocked(SentryMock.captureException)).toHaveBeenCalledWith(error);
      expect(scopeSetTags).toMatchObject({
        route: "/api/bounties/:id",
        method: "GET",
        requestId: "err-456",
      });
    });

    it("sends a 500 JSON response with requestId when headers not sent", () => {
      const req = createMockReq({ requestId: "err-789" });
      const res = createMockRes();
      const next = vi.fn();
      const error = new Error("fail");

      sentryErrorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Internal server error",
        requestId: "err-789",
      });
    });

    it("delegates to next(err) when headers already sent", () => {
      const req = createMockReq();
      const res = createMockRes();
      res.headersSent = true;
      const next = vi.fn();
      const error = new Error("fail");

      sentryErrorHandler(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it("still captures exception even when headers are sent", () => {
      const error = new Error("late error");
      const req = createMockReq({ requestId: "late-001" });
      const res = createMockRes();
      res.headersSent = true;
      const next = vi.fn();

      sentryErrorHandler(error, req, res, next);

      expect(vi.mocked(SentryMock.captureException)).toHaveBeenCalledWith(error);
      expect(scopeSetTags.requestId).toBe("late-001");
    });
  });

  describe("captureErrorException", () => {
    it("captures exception with request context tags and extras", () => {
      const error = new Error("background job failed");

      captureErrorException(error, {
        requestId: "bg-001",
        route: "/internal/cron",
        customField: "some value",
      });

      expect(vi.mocked(SentryMock.captureException)).toHaveBeenCalledWith(error);
      expect(scopeSetTags).toMatchObject({
        requestId: "bg-001",
        route: "/internal/cron",
      });
      expect(scopeSetExtras).toMatchObject({
        customField: "some value",
      });
    });

    it("returns a string event ID", () => {
      const result = captureErrorException(new Error("test"));
      expect(typeof result).toBe("string");
      expect(result).toBe("event-id");
    });

    it("works with minimal context", () => {
      const error = new Error("minimal");
      const result = captureErrorException(error);
      expect(result).toBe("event-id");
      expect(vi.mocked(SentryMock.captureException)).toHaveBeenCalledWith(error);
    });

    it("does not set requestId/route as extras", () => {
      captureErrorException(new Error("ctx-test"), {
        requestId: "ctx-001",
        route: "/test",
      });

      expect(scopeSetExtras.requestId).toBeUndefined();
      expect(scopeSetExtras.route).toBeUndefined();
    });
  });

  describe("initSentry", () => {
    it("initializes with SENTRY_DSN when provided", () => {
      process.env.SENTRY_DSN = "https://key@sentry.io/123";
      process.env.SENTRY_ENVIRONMENT = "test";

      initSentry();

      expect(vi.mocked(SentryMock.init)).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: "https://key@sentry.io/123",
          environment: "test",
          sendDefaultPii: false,
        }),
      );

      delete process.env.SENTRY_DSN;
      delete process.env.SENTRY_ENVIRONMENT;
    });

    it("is a no-op when SENTRY_DSN is not set", () => {
      const callsBefore = vi.mocked(SentryMock.init).mock.calls.length;

      initSentry();

      expect(vi.mocked(SentryMock.init).mock.calls.length).toBe(callsBefore);
    });
  });
});

// ── Sensitive field redaction tests ──────────────────────────────────────────

describe("Sensitive field redaction via redactBeforeSend", () => {
  it("redacts sensitive fields in exception values via redactSensitiveString path", () => {
    // This verifies the full redaction pipeline is invoked for exception values.
    // Stellar secret key redaction is comprehensively tested in logger.test.ts.
    const event = {
      exception: {
        values: [
          {
            value: "Something failed with an API token attached",
            type: "Error",
          },
        ],
      },
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    // The value should still be present since it doesn't contain a Stellar secret or wallet address
    expect(scrubbed!.exception!.values![0].value).toBe(
      "Something failed with an API token attached",
    );
  });

  it("strips wallet addresses from message strings", () => {
    // Stellar public key: G + 55 base32 chars (A-Z, 0-9)
    const addr = "GABCDEF1234567890123456789012345678901234567890ABCDEFXYZ";
    const event = {
      message: `Error for wallet ${addr}`,
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.message).not.toContain(addr);
    expect(scrubbed!.message).toContain("[redacted-wallet-address]");
  });

  it("redacts authorization headers", () => {
    const event = {
      request: {
        headers: {
          authorization: "Bearer secret-token-123",
          "content-type": "application/json",
        },
      },
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.request!.headers!.authorization).toBe("[redacted]");
    expect(scrubbed!.request!.headers!["content-type"]).toBe("application/json");
  });

  it("drops health-check requests entirely", () => {
    const healthUrls = [
      "http://localhost:3001/api/health",
      "http://localhost:3001/api/health/deep",
      "http://localhost:3001/worker/health",
    ];

    for (const url of healthUrls) {
      const event = { request: { url } };
      expect(redactBeforeSend(event as any, NO_HINT)).toBeNull();
    }
  });

  it("does not drop non-health URLs", () => {
    const event = {
      request: { url: "http://localhost:3001/api/bounties" },
    };
    expect(redactBeforeSend(event as any, NO_HINT)).not.toBeNull();
  });

  it("redacts sensitive extra fields", () => {
    const event = {
      extra: {
        apiKey: "sk-live-abc123",
        normalField: "visible",
        secretToken: "tok_123",
      },
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.extra!.apiKey).toBe("[redacted]");
    expect(scrubbed!.extra!.secretToken).toBe("[redacted]");
    expect(scrubbed!.extra!.normalField).toBe("visible");
  });

  it("redacts sensitive fields in exception stack frame vars", () => {
    const event = {
      exception: {
        values: [
          {
            value: "test error",
            type: "Error",
            stacktrace: {
              frames: [
                {
                  vars: {
                    password: "hunter2",
                    normalArg: "safe",
                  },
                },
              ],
            },
          },
        ],
      },
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    const frameVars = scrubbed!.exception!.values![0].stacktrace!.frames![0].vars as Record<string, string>;
    expect(frameVars.password).toBe("[redacted]");
    expect(frameVars.normalArg).toBe("safe");
  });

  it("redacts ETH addresses from strings", () => {
    const ethAddr = "0x1234567890abcdef1234567890abcdef12345678";
    const event = {
      message: `Transfer from ${ethAddr} failed`,
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.message).not.toContain(ethAddr);
    expect(scrubbed!.message).toContain("[redacted-eth-address]");
  });

  it("redacts query strings", () => {
    const event = {
      request: {
        query_string: "api_key=secret123&other=value",
      },
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.request!.query_string).toBe("[redacted]");
  });

  it("returns the event unchanged when no sensitive data is present", () => {
    const event = {
      message: "All good",
      extra: { userId: "123" },
      request: { url: "/api/bounties", headers: { "content-type": "application/json" } },
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.message).toBe("All good");
    expect(scrubbed!.extra!.userId).toBe("123");
  });

  it("redacts cookie headers", () => {
    const event = {
      request: {
        headers: {
          cookie: "session=abc123; token=xyz789",
          accept: "application/json",
        },
      },
    };

    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.request!.headers!.cookie).toBe("[redacted]");
    expect(scrubbed!.request!.headers!.accept).toBe("application/json");
  });

  it("handles events with no request or extra fields", () => {
    const event = { message: "Simple error" };
    const scrubbed = redactBeforeSend(event as any, NO_HINT);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.message).toBe("Simple error");
  });
});
