import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wrapping of external-dependency failures in middleware (#1305).
// Every failure below must reach the client as a fixed message: never the
// raw fs/lockfile/bcrypt error text, errno code, filesystem path, or stack.

const MAINTAINER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `mw-deps-${randomUUID()}-`));
  process.env.NODE_ENV = "production";
  vi.resetModules();
});

afterEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.MAINTAINER_RATE_LIMIT_STORE_PATH;
  delete process.env.ADMIN_API_KEY_HASH;
  vi.doUnmock("proper-lockfile");
  vi.doUnmock("bcryptjs");
  vi.restoreAllMocks();
  try {
    fs.chmodSync(path.join(tmpDir, "limits.json"), 0o644);
  } catch {
    /* best-effort */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadModules() {
  const errors = await import("../src/middleware/errors");
  const { logger } = await import("../src/logger");
  const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
  return { ...errors, errorSpy };
}

async function buildLimiterApp() {
  const { createTerminalErrorHandler } = await import("../src/middleware/errors");
  const { maintainerLimiter } = await import("../src/middleware/maintainerLimiter");
  const app = express();
  app.use(express.json());
  app.post("/limited", maintainerLimiter, (_req, res) => {
    res.status(201).json({ ok: true });
  });
  app.use(createTerminalErrorHandler());
  return app;
}

function expectNoRawDetail(text: string, ...fragments: string[]) {
  for (const fragment of fragments) {
    expect(text).not.toContain(fragment);
  }
  expect(text).not.toMatch(/\bE[A-Z]{3,}\b/); // errno codes such as ENOTDIR, EACCES
  expect(text).not.toMatch(/\n\s+at /); // stack frames
}

describe("maintainerLimiter — JSON store and file-lock failures", () => {
  it("wraps a store-initialisation failure as a 503 with a fixed message", async () => {
    const blocker = path.join(tmpDir, "not-a-dir");
    fs.writeFileSync(blocker, "");
    process.env.MAINTAINER_RATE_LIMIT_STORE_PATH = path.join(blocker, "limits.json");

    const { errorSpy } = await loadModules();
    const app = await buildLimiterApp();

    const res = await request(app).post("/limited").send({ maintainer: MAINTAINER });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "Rate limit store is unavailable, please try again." });
    expectNoRawDetail(res.text, tmpDir, "not-a-dir");

    const [fields, msg] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe("middleware_dependency_failure");
    expect(fields.operation).toBe("maintainer_rate_limit.init_store");
    expect(fields.dependency).toBe("json-store");
    expect((fields.err as NodeJS.ErrnoException).code).toBe("ENOTDIR");
  });

  it("wraps a store read failure and keeps the original cause for logging", async () => {
    const storePath = path.join(tmpDir, "limits.json");
    fs.mkdirSync(storePath); // a directory where a file is expected → EISDIR on read
    process.env.MAINTAINER_RATE_LIMIT_STORE_PATH = storePath;

    const { errorSpy } = await loadModules();
    const app = await buildLimiterApp();

    const res = await request(app).post("/limited").send({ maintainer: MAINTAINER });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Rate limit store is unavailable, please try again.");
    expectNoRawDetail(res.text, storePath, "EISDIR");

    const [fields] = errorSpy.mock.calls[0] as [Record<string, unknown>];
    expect(fields.operation).toBe("maintainer_rate_limit.read_store");
    expect((fields.err as NodeJS.ErrnoException).code).toBe("EISDIR");
  });

  it("wraps a store write failure and releases the lock so the next request is not blocked", async () => {
    if (process.getuid?.() === 0) {
      return; // root ignores file permissions, so the write cannot be made to fail this way
    }
    const storePath = path.join(tmpDir, "limits.json");
    fs.writeFileSync(storePath, "{}");
    fs.chmodSync(storePath, 0o444);
    process.env.MAINTAINER_RATE_LIMIT_STORE_PATH = storePath;

    const { errorSpy } = await loadModules();
    const app = await buildLimiterApp();

    const res = await request(app).post("/limited").send({ maintainer: MAINTAINER });

    expect(res.status).toBe(503);
    expectNoRawDetail(res.text, storePath, "EACCES");
    const [fields] = errorSpy.mock.calls[0] as [Record<string, unknown>];
    expect(fields.operation).toBe("maintainer_rate_limit.write_store");
    expect((fields.err as NodeJS.ErrnoException).code).toBe("EACCES");

    // Lock was released: once the file is writable again the request succeeds
    // immediately instead of waiting for the 5s stale-lock timeout.
    fs.chmodSync(storePath, 0o644);
    await request(app).post("/limited").send({ maintainer: MAINTAINER }).expect(201);
  });

  it("wraps a lock-acquisition failure as 503 'Service busy' with the lock error as cause", async () => {
    process.env.MAINTAINER_RATE_LIMIT_STORE_PATH = path.join(tmpDir, "limits.json");
    const lockError = Object.assign(new Error(`Lock file is already being held: ${tmpDir}`), {
      code: "ELOCKED",
    });
    vi.doMock("proper-lockfile", () => ({
      default: { lock: vi.fn().mockRejectedValue(lockError) },
    }));

    const { errorSpy } = await loadModules();
    const app = await buildLimiterApp();

    const res = await request(app).post("/limited").send({ maintainer: MAINTAINER });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "Service busy, please try again." });
    expectNoRawDetail(res.text, tmpDir, "ELOCKED", "already being held");

    const [fields] = errorSpy.mock.calls[0] as [Record<string, unknown>];
    expect(fields.operation).toBe("maintainer_rate_limit.acquire_lock");
    expect(fields.dependency).toBe("file-lock");
    expect(fields.err).toBe(lockError);
  });

  it("does not fail a successful request when releasing the lock fails", async () => {
    process.env.MAINTAINER_RATE_LIMIT_STORE_PATH = path.join(tmpDir, "limits.json");
    const release = vi.fn().mockRejectedValue(new Error("ENOENT: lock already removed"));
    vi.doMock("proper-lockfile", () => ({
      default: { lock: vi.fn().mockResolvedValue(release) },
    }));

    const { logger } = await import("../src/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const app = await buildLimiterApp();

    await request(app).post("/limited").send({ maintainer: MAINTAINER }).expect(201);
    expect(release).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toBe("maintainer_rate_limit_release_failed");
  });
});

describe("adminAuth — bcrypt failure", () => {
  it("wraps a bcrypt.compare rejection as a 500 with a fixed message", async () => {
    process.env.ADMIN_API_KEY_HASH = "$2a$04$stored-hash";
    const bcryptError = new Error("Illegal arguments: string, undefined (internal detail)");
    vi.doMock("bcryptjs", () => ({
      default: { compare: vi.fn().mockRejectedValue(bcryptError) },
    }));

    const { errorSpy, createTerminalErrorHandler } = await loadModules();
    const { createAdminApiKeyAuthMiddleware } = await import("../src/middleware/adminAuth");
    const app = express();
    app.get("/admin", createAdminApiKeyAuthMiddleware(), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(createTerminalErrorHandler());

    const res = await request(app).get("/admin").set("x-admin-api-key", "any-key");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to verify admin API key." });
    expectNoRawDetail(res.text, "Illegal arguments", "internal detail", "$2a$04$");

    const [fields] = errorSpy.mock.calls[0] as [Record<string, unknown>];
    expect(fields.operation).toBe("admin_api_key.compare");
    expect(fields.dependency).toBe("bcrypt");
    expect(fields.err).toBe(bcryptError);
  });
});

describe("createTerminalErrorHandler", () => {
  async function buildThrowingApp(error: unknown, withRequestId = false) {
    const { createTerminalErrorHandler } = await import("../src/middleware/errors");
    const app = express();
    if (withRequestId) {
      app.use((req, _res, next) => {
        req.requestId = "req-123";
        next();
      });
    }
    app.get("/boom", (_req, _res, next) => next(error));
    app.use(createTerminalErrorHandler());
    return app;
  }

  it("replaces an unknown raw error with a generic 500 and logs the original", async () => {
    const { errorSpy } = await loadModules();
    const raw = new Error("connect ECONNREFUSED 10.0.0.5:6379 at /srv/app/node_modules/ioredis");
    const app = await buildThrowingApp(raw);

    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: "Internal server error." });
    expectNoRawDetail(res.text, "ECONNREFUSED", "10.0.0.5", "/srv/app");
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ err: raw }), "unhandled_request_error");
  });

  it("treats non-Error throwables (strings, plain objects) as internal errors", async () => {
    await loadModules();
    for (const thrown of ["raw string with secret", { detail: "object" }]) {
      const app = await buildThrowingApp(thrown);
      const res = await request(app).get("/boom").expect(500);
      expect(res.body).toEqual({ error: "Internal server error." });
    }
  });

  it("passes through exposed 4xx http-errors (e.g. body-parser) with their own status", async () => {
    await loadModules();
    const clientErr = Object.assign(new Error("unsupported charset \"LATIN-9\""), {
      status: 415,
      expose: true,
    });
    const app = await buildThrowingApp(clientErr);

    const res = await request(app).get("/boom").expect(415);
    expect(res.body).toEqual({ error: "unsupported charset \"LATIN-9\"" });
  });

  it("does not expose 5xx errors or 4xx errors lacking expose: true", async () => {
    await loadModules();
    const exposed5xx = Object.assign(new Error("upstream detail"), { status: 502, expose: true });
    const unexposed4xx = Object.assign(new Error("internal 4xx detail"), { statusCode: 409 });

    for (const err of [exposed5xx, unexposed4xx]) {
      const app = await buildThrowingApp(err);
      const res = await request(app).get("/boom").expect(500);
      expect(res.body).toEqual({ error: "Internal server error." });
    }
  });

  it("includes the request id when request context is present", async () => {
    const { MiddlewareDependencyError } = await loadModules();
    const err = new MiddlewareDependencyError({
      operation: "test.op",
      dependency: "json-store",
      statusCode: 503,
      publicMessage: "Try again.",
      cause: new Error("disk detail"),
    });
    const app = await buildThrowingApp(err, true);

    const res = await request(app).get("/boom").expect(503);
    expect(res.body).toEqual({ error: "Try again.", requestId: "req-123" });
  });

  it("delegates to Express when headers were already sent", async () => {
    const { createTerminalErrorHandler } = await loadModules();
    const handler = createTerminalErrorHandler();
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() };
    const err = new Error("late failure");

    handler(err, {} as express.Request, res as unknown as express.Response, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("MiddlewareDependencyError", () => {
  it("keeps the cause and operation but leaves the cause's text out of message", async () => {
    const { MiddlewareDependencyError } = await import("../src/middleware/errors");
    const cause = new Error("EACCES: permission denied, open '/secret/path'");
    const err = new MiddlewareDependencyError({
      operation: "maintainer_rate_limit.write_store",
      dependency: "json-store",
      statusCode: 503,
      publicMessage: "Rate limit store is unavailable, please try again.",
      cause,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MiddlewareDependencyError");
    expect(err.cause).toBe(cause);
    expect(err.operation).toBe("maintainer_rate_limit.write_store");
    expect(err.message).toBe("maintainer_rate_limit.write_store failed (json-store)");
    expect(err.message).not.toContain("/secret/path");
  });
});
