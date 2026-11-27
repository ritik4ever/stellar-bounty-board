import { describe, expect, it } from "vitest";
import { requireJsonContentType } from "../../src/middleware/contentType";
import { mockNext, mockReq, mockRes } from "./helpers";

function run(method: string, contentType?: string) {
  const out = mockRes();
  const next = mockNext();
  requireJsonContentType(
    mockReq({ method, headers: contentType === undefined ? {} : { "content-type": contentType } }),
    out.res,
    next,
  );
  return { ...out, next };
}

describe("requireJsonContentType", () => {
  it.each(["GET", "DELETE", "PUT", "OPTIONS", "HEAD"])("does not check %s requests", (method) => {
    const out = run(method, "text/plain");
    expect(out.next).toHaveBeenCalledWith();
    expect(out.res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "application/json"],
    ["PATCH", "application/json"],
    ["POST", "application/json; charset=utf-8"],
    ["POST", "application/json;charset=UTF-8"],
  ])("allows %s with %s", (method, contentType) => {
    const out = run(method, contentType);
    expect(out.next).toHaveBeenCalledWith();
    expect(out.res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", undefined],
    ["POST", ""],
    ["POST", "text/plain"],
    ["POST", "application/x-www-form-urlencoded"],
    ["PATCH", "multipart/form-data; boundary=x"],
    // The check is case-sensitive.
    ["POST", "Application/JSON"],
  ])("rejects %s with content-type %j as 415", (method, contentType) => {
    const out = run(method, contentType);
    expect(out.statusCode()).toBe(415);
    expect(out.body()).toEqual({ error: "Content-Type must be application/json" });
    expect(out.next).not.toHaveBeenCalled();
  });
});
