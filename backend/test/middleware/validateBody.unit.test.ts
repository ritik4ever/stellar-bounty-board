import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateBody } from "../../src/middleware/validateBody";
import { mockNext, mockReq, mockRes } from "./helpers";

function run(schema: z.ZodTypeAny, body: unknown) {
  const out = mockRes();
  const next = mockNext();
  const req = mockReq({ body });
  validateBody(schema)(req, out.res, next);
  return { ...out, next, req };
}

describe("validateBody", () => {
  it("replaces req.body with parsed output (defaults, transforms, stripped keys)", () => {
    const schema = z.object({
      name: z.string().trim().transform((s) => s.toUpperCase()),
      tags: z.array(z.string()).default([]),
    });
    const out = run(schema, { name: "  alice ", extra: true });
    expect(out.next).toHaveBeenCalledWith();
    expect(out.req.body).toEqual({ name: "ALICE", tags: [] });
  });

  it.each([
    ["undefined body", undefined],
    ["null body", null],
    ["array body", []],
    ["string body", "not an object"],
  ])("returns 400 for %s", (_label, body) => {
    const out = run(z.object({ name: z.string() }), body);
    expect(out.statusCode()).toBe(400);
    expect(out.body()).toMatchObject({ error: "Validation failed" });
    expect(out.next).not.toHaveBeenCalled();
  });

  it("reports every failing issue with its path", () => {
    const out = run(z.object({ a: z.string(), b: z.number() }), { a: 1, b: "x" });
    const details = (out.body() as { details: Array<{ path: string[] }> }).details;
    expect(details.map((d) => d.path.join("."))).toEqual(["a", "b"]);
  });

  it("leaves req.body untouched on failure", () => {
    const body = { a: 1 };
    const out = run(z.object({ a: z.string() }), body);
    expect(out.req.body).toBe(body);
  });

  it("accepts a boundary value exactly at a limit and rejects one past it", () => {
    const schema = z.object({ title: z.string().max(5) });
    expect(run(schema, { title: "12345" }).next).toHaveBeenCalledWith();
    expect(run(schema, { title: "123456" }).statusCode()).toBe(400);
  });

  it("propagates an exception thrown inside a refinement to the caller", () => {
    const boom = new Error("refinement exploded");
    const schema = z.object({ a: z.string() }).refine(() => {
      throw boom;
    });
    const out = mockRes();
    const next = mockNext();
    expect(() => validateBody(schema)(mockReq({ body: { a: "x" } }), out.res, next)).toThrow(boom);
    expect(next).not.toHaveBeenCalled();
    expect(out.res.status).not.toHaveBeenCalled();
  });

  it("throws for schemas with async refinements", () => {
    const schema = z.object({ a: z.string() }).refine(async () => true);
    const out = mockRes();
    expect(() => validateBody(schema)(mockReq({ body: { a: "x" } }), out.res, mockNext())).toThrow(
      /async/i,
    );
  });
});
