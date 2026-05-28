import { describe, it, expect } from "vitest";
import { expireStaleReservations } from "../src/services/reservationExpirationJob";

describe("expireStaleReservations", () => {
  it("returns a number (0 when no stale reservations)", () => {
    const result = expireStaleReservations();
    expect(typeof result.expiredCount).toBe("number");
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
  });
});
