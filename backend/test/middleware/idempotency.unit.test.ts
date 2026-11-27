import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetIdempotencyStoreForTests,
  idempotencyMiddleware,
} from "../../src/middleware/idempotency";
import { mockNext, mockReq, mockRes } from "./helpers";

const TTL_MS = 10 * 60 * 1000;

function buildApp(handler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.post("/op", idempotencyMiddleware, handler);
  app.post("/other", idempotencyMiddleware, handler);
  return app;
}

function countingHandler(status = 201) {
  let calls = 0;
  const handler: express.RequestHandler = (_req, res) => {
    calls += 1;
    res.status(status).json({ call: calls });
  };
  return { handler, calls: () => calls };
}

beforeEach(() => {
  __resetIdempotencyStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("idempotencyMiddleware", () => {
  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["a whitespace-only header", "   "],
  ])("passes through and does not wrap res.json with %s", (_label, key) => {
    const out = mockRes();
    const originalJson = out.res.json;
    const next = mockNext();
    idempotencyMiddleware(mockReq({ headers: { "idempotency-key": key } }), out.res, next);
    expect(next).toHaveBeenCalledWith();
    expect(out.res.json).toBe(originalJson);
  });

  it("runs the handler every time when no key is sent", async () => {
    const { handler, calls } = countingHandler();
    const app = buildApp(handler);
    await request(app).post("/op").send({});
    await request(app).post("/op").send({});
    expect(calls()).toBe(2);
  });

  it("replays the first status and body for a repeated key without calling the handler", async () => {
    const { handler, calls } = countingHandler(201);
    const app = buildApp(handler);
    const first = await request(app).post("/op").set("Idempotency-Key", "k1").send({});
    const second = await request(app).post("/op").set("Idempotency-Key", "k1").send({});
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual({ call: 1 });
    expect(calls()).toBe(1);
  });

  it("replays error responses too", async () => {
    const { handler, calls } = countingHandler(422);
    const app = buildApp(handler);
    await request(app).post("/op").set("Idempotency-Key", "err").send({});
    const replay = await request(app).post("/op").set("Idempotency-Key", "err").send({});
    expect(replay.status).toBe(422);
    expect(calls()).toBe(1);
  });

  it("trims the key, so padded and unpadded keys share an entry", async () => {
    const { handler, calls } = countingHandler();
    const app = buildApp(handler);
    await request(app).post("/op").set("Idempotency-Key", "  k2  ").send({});
    await request(app).post("/op").set("Idempotency-Key", "k2").send({});
    expect(calls()).toBe(1);
  });

  it("scopes keys globally, not per route", async () => {
    const { handler, calls } = countingHandler();
    const app = buildApp(handler);
    await request(app).post("/op").set("Idempotency-Key", "shared").send({});
    const other = await request(app).post("/other").set("Idempotency-Key", "shared").send({});
    expect(other.body).toEqual({ call: 1 });
    expect(calls()).toBe(1);
  });

  it("uses the first value when the header is an array", () => {
    const first = mockRes();
    idempotencyMiddleware(mockReq({ headers: { "idempotency-key": ["a", "b"] } }), first.res, mockNext());
    first.res.json({ stored: true });

    const replay = mockRes();
    const next = mockNext();
    idempotencyMiddleware(mockReq({ headers: { "idempotency-key": "a" } }), replay.res, next);
    expect(next).not.toHaveBeenCalled();
    expect(replay.body()).toEqual({ stored: true });
  });

  it("does not cache responses sent without res.json", async () => {
    let calls = 0;
    const app = buildApp((_req, res) => {
      calls += 1;
      res.status(204).end();
    });
    await request(app).post("/op").set("Idempotency-Key", "no-json").send({});
    await request(app).post("/op").set("Idempotency-Key", "no-json").send({});
    expect(calls).toBe(2);
  });

  it("expires an entry at the 10 minute TTL boundary", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { handler, calls } = countingHandler();
    const app = buildApp(handler);
    await request(app).post("/op").set("Idempotency-Key", "ttl").send({});

    now.mockReturnValue(1_000_000 + TTL_MS - 1);
    await request(app).post("/op").set("Idempotency-Key", "ttl").send({});
    expect(calls()).toBe(1);

    now.mockReturnValue(1_000_000 + TTL_MS);
    const fresh = await request(app).post("/op").set("Idempotency-Key", "ttl").send({});
    expect(calls()).toBe(2);
    expect(fresh.body).toEqual({ call: 2 });
  });

  it("runs the handler for each concurrent request that arrives before the first responds", async () => {
    let calls = 0;
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const app = buildApp(async (_req, res) => {
      calls += 1;
      await gate;
      res.json({ call: calls });
    });

    // supertest only sends on then(); start both requests now.
    const inFlight = [0, 1].map(() =>
      request(app).post("/op").set("Idempotency-Key", "race").send({}).then((res) => res),
    );
    await vi.waitFor(() => expect(calls).toBe(2));
    releaseFirst();
    await Promise.all(inFlight);
    expect(calls).toBe(2);
  });

  it("propagates a handler error without caching anything", async () => {
    const app = buildApp(() => {
      throw new Error("handler failed");
    });
    app.use(((_err, _req, res, _next) => {
      res.status(500).end();
    }) as express.ErrorRequestHandler);
    await request(app).post("/op").set("Idempotency-Key", "throws").send({}).expect(500);
    await request(app).post("/op").set("Idempotency-Key", "throws").send({}).expect(500);
  });
});

describe("__resetIdempotencyStoreForTests", () => {
  it("clears all cached entries", async () => {
    const { handler, calls } = countingHandler();
    const app = buildApp(handler);
    await request(app).post("/op").set("Idempotency-Key", "reset").send({});
    __resetIdempotencyStoreForTests();
    await request(app).post("/op").set("Idempotency-Key", "reset").send({});
    expect(calls()).toBe(2);
  });
});
