import { describe, it, expect } from "vitest";
import { expireStaleReservations } from "../src/services/reservationExpirationJob";

describe("expireStaleReservations", () => {
  it("returns an ExpirationResult summary", () => {
    const result = expireStaleReservations();
    expect(result).toBeTypeOf("object");
    expect(typeof result.expiredCount).toBe("number");
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.expiredBountyIds)).toBe(true);
    expect(typeof result.checkedAt).toBe("number");
  });
});
