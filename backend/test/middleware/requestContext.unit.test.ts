import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/logger";
import { requestContextMiddleware } from "../../src/middleware/requestContext";
import { mockNext, mockReq, mockRes } from "./helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

function run(requestId?: string | string[], init: Parameters<typeof mockReq>[0] = {}) {
  const info = vi.fn();
  const child = vi.spyOn(logger, "child").mockReturnValue({ info } as unknown as typeof logger);
  const req = mockReq({ ...init, headers: { "x-request-id": requestId, ...init.headers } });
  const out = mockRes();
  const next = mockNext();
  requestContextMiddleware(req, out.res, next);
  return { ...out, req, next, info, child };
}

describe("requestContextMiddleware", () => {
  it.each([
    ["a simple id", "abc-123", "abc-123"],
    ["a padded id (trimmed)", "  abc-123  ", "abc-123"],
    ["a 128 character id", "a".repeat(128), "a".repeat(128)],
  ])("honours %s", (_label, incoming, expected) => {
    const out = run(incoming);
    expect(out.req.requestId).toBe(expected);
    expect(out.headers["x-request-id"]).toBe(expected);
    expect(out.child).toHaveBeenCalledWith({ requestId: expected });
    expect(out.next).toHaveBeenCalledWith();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["129 characters", "a".repeat(129)],
    ["containing spaces", "abc 123"],
    ["containing injection characters", "abc\nlevel=error"],
    ["containing underscores", "abc_123"],
    ["an array", ["abc", "def"]],
  ])("generates a UUID when the incoming id is %s", (_label, incoming) => {
    const out = run(incoming);
    expect(out.req.requestId).toMatch(UUID);
    expect(out.headers["x-request-id"]).toBe(out.req.requestId);
  });

  it("generates a different id for each request", () => {
    expect(run().req.requestId).not.toBe(run().req.requestId);
  });

  it("attaches the child logger and logs one line on finish with method, path, status, duration", () => {
    const out = run("req-1", { method: "PATCH", path: "/api/bounties/1" });
    expect(out.req.log.info).toBe(out.info);
    expect(out.info).not.toHaveBeenCalled();

    out.res.status(204);
    out.finish();

    expect(out.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = out.info.mock.calls[0];
    expect(msg).toBe("http_request");
    expect(fields).toMatchObject({ method: "PATCH", path: "/api/bounties/1", status: 204 });
    expect(fields.durationMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(fields).sort()).toEqual(["durationMs", "method", "path", "status"]);
  });

  it("logs '/' when the request path is empty", () => {
    const out = run("req-2", { path: "" });
    out.finish();
    expect(out.info.mock.calls[0][0].path).toBe("/");
  });
});
