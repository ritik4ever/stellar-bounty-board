import { describe, it, expect } from "vitest";
import { expireStaleReservations } from "../src/services/reservationExpirationJob";

describe("expireStaleReservations", () => {
  it("returns a result object with a non-negative expired count", () => {
    const result = expireStaleReservations();
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.expiredBountyIds)).toBe(true);
    expect(result.checkedAt).toBeGreaterThan(0);
  });
});
