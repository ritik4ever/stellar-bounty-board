import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — plain JS worker module, no type declarations
import {
  CORRELATION_ID_PATTERN,
  createCorrelationLogger,
  normalizeCorrelationId,
  resolveWorkerCorrelationId,
} from "../worker/correlation.js";

describe("worker correlation helpers (#1457)", () => {
  it("reuses a valid correlation id supplied through workerData", () => {
    expect(resolveWorkerCorrelationId({ correlationId: "session-1" })).toBe("session-1");
    expect(resolveWorkerCorrelationId({ correlationId: " padded " })).toBe("padded");
  });

  it("mints an id when workerData is missing or the id is malformed", () => {
    const generate = () => "generated";
    expect(resolveWorkerCorrelationId(undefined, generate)).toBe("generated");
    expect(resolveWorkerCorrelationId(null, generate)).toBe("generated");
    expect(resolveWorkerCorrelationId({}, generate)).toBe("generated");
    expect(resolveWorkerCorrelationId({ correlationId: "" }, generate)).toBe("generated");
    expect(resolveWorkerCorrelationId({ correlationId: "bad id" }, generate)).toBe("generated");
    expect(resolveWorkerCorrelationId({ correlationId: 123 }, generate)).toBe("generated");
  });

  it("normalises ids the same way as the backend", () => {
    expect(normalizeCorrelationId("abc-123")).toBe("abc-123");
    expect(normalizeCorrelationId("abc_123")).toBeUndefined();
    expect(normalizeCorrelationId(7)).toBeUndefined();
    expect(CORRELATION_ID_PATTERN.test("abc-123")).toBe(true);
  });

  it("prefixes every log line with the correlation id", () => {
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const log = createCorrelationLogger("cid-42", sink);

    log.info("Indexed 3 new events.");
    log.warn("slow poll");
    log.error("boom", "detail");

    expect(sink.log).toHaveBeenCalledWith("[Indexer][cid=cid-42] Indexed 3 new events.");
    expect(sink.warn).toHaveBeenCalledWith("[Indexer][cid=cid-42] slow poll");
    expect(sink.error).toHaveBeenCalledWith("[Indexer][cid=cid-42] boom", "detail");
    expect(log.correlationId).toBe("cid-42");
  });
});
