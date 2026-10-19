import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// ── Mocks ────────────────────────────────────────────────────────────────────
const { mockAxiosGet } = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { get: mockAxiosGet },
}));

// Helper to create a fake Soroban RPC response body
function fakeEventsResponse(events: Record<string, unknown>[]) {
  return { data: { events } };
}

// Sample well-formed events
const eventA = {
  id: "1",
  type: "create",
  bounty_id: "BNT-0001",
  actor: "GAAA",
  timestamp: 1700000000,
};

const eventB = {
  id: "2",
  type: "release",
  bounty_id: "BNT-0001",
  actor: "GBBB",
  timestamp: 1700001000,
};

const eventC = {
  id: "3",
  type: "reserve",
  bounty_id: "BNT-0002",
  actor: "GCCC",
  timestamp: 1700002000,
};

// ── Import the indexer after mocks are set up ────────────────────────────────
import { pollEvents, startWorker } from "../worker/indexer.js";

// ── Test suite ───────────────────────────────────────────────────────────────
describe("Indexer Worker — event polling and ingestion", () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let writeFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh spies each time to avoid restore issues
    existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("[]");
    writeFileSyncSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Default: RPC returns empty events
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([]));
  });

  // ── Successful event ingestion ──────────────────────────────────────────
  it("normalizes and ingests a batch of successful events", async () => {
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([eventA, eventB]));

    await pollEvents();

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    const [url, config] = mockAxiosGet.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain("/events");
    expect(config.params).toHaveProperty("contract_id");

    // Events should have been written to disk
    expect(writeFileSyncSpy).toHaveBeenCalled();
    const written = JSON.parse(writeFileSyncSpy.mock.calls[0][1] as string);
    expect(written).toHaveLength(2);
    expect(written[0].bountyId).toBe("BNT-0001");
    expect(written[0].type).toBe("create");
    expect(written[1].type).toBe("release");
  });

  it("logs the number of indexed events on success", async () => {
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([eventA]));
    await pollEvents();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Indexed 1 new events"),
    );
  });

  // ── Malformed event payloads ────────────────────────────────────────────
  it("normalizes a malformed event without crashing", async () => {
    const malformedEvent = { id: "99", unexpected: true };
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([malformedEvent]));

    await pollEvents();

    expect(writeFileSyncSpy).toHaveBeenCalled();
    const written = JSON.parse(writeFileSyncSpy.mock.calls[0][1] as string);
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe("99");
  });

  it("handles an empty events array from RPC without error", async () => {
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([]));

    await pollEvents();

    expect(writeFileSyncSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("No new events"),
    );
  });

  it("handles undefined events field in RPC response", async () => {
    mockAxiosGet.mockResolvedValue({ data: {} });

    await pollEvents();

    // Should not throw, no events to process
    expect(writeFileSyncSpy).not.toHaveBeenCalled();
  });

  // ── RPC error responses ─────────────────────────────────────────────────
  it("retries on RPC errors and eventually succeeds", async () => {
    vi.useFakeTimers();
    mockAxiosGet
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockRejectedValueOnce(new Error("RPC 503"))
      .mockResolvedValue(fakeEventsResponse([eventA]));

    const promise = pollEvents();
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(mockAxiosGet).toHaveBeenCalledTimes(3);
    expect(writeFileSyncSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("logs error and resolves after exhausting all retries on persistent RPC failure", async () => {
    // Speed up the exponential backoff so the test doesn't time out
    vi.useFakeTimers();
    mockAxiosGet.mockRejectedValue(new Error("Permanent RPC failure"));

    const promise = pollEvents();
    // Advance past all retry backoffs (1+2+4+8+16 = 31s for 5 retries)
    await vi.advanceTimersByTimeAsync(32_000);

    await promise;

    // pollEvents catches internally and logs the failure
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("All"),
      expect.stringContaining("Permanent RPC failure"),
    );
    expect(mockAxiosGet).toHaveBeenCalledTimes(5);

    vi.useRealTimers();
  });

  // ── Polling cursor advancement ──────────────────────────────────────────
  it("uses the last event ID as the cursor for the next poll", async () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(
      JSON.stringify([{ id: "5", type: "release", bountyId: "BNT-0001" }]),
    );

    mockAxiosGet.mockResolvedValue(fakeEventsResponse([eventB]));

    await pollEvents();

    const [, config] = mockAxiosGet.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params.from_id).toBe("5");
  });

  it("does not reprocess previously ingested events", async () => {
    // First poll returns events A and B
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([eventA, eventB]));
    await pollEvents();

    const firstWrite = JSON.parse(writeFileSyncSpy.mock.calls[0][1] as string);
    expect(firstWrite).toHaveLength(2);

    // Reset mocks for second poll
    vi.clearAllMocks();
    existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(firstWrite));
    writeFileSyncSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Second poll returns only a new event C (id: "3")
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([eventC]));

    await pollEvents();

    // The cursor should be "2" (last ID from the persisted file)
    const [, config] = mockAxiosGet.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params.from_id).toBe("2");

    // New write should contain A, B, C (appended)
    const secondWrite = JSON.parse(writeFileSyncSpy.mock.calls[0][1] as string);
    expect(secondWrite).toHaveLength(3);
    expect(secondWrite[2].id).toBe("3");
    expect(secondWrite[2].type).toBe("reserve");
  });

  it("starts with null cursor when no index file exists", async () => {
    existsSyncSpy.mockReturnValue(false);
    mockAxiosGet.mockResolvedValue(fakeEventsResponse([]));

    await pollEvents();

    const [, config] = mockAxiosGet.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params.from_id).toBeNull();
  });

  // ── startWorker ─────────────────────────────────────────────────────────
  it("startWorker is exported and callable", () => {
    expect(typeof startWorker).toBe("function");
  });
});
