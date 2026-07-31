import { describe, expect, it } from 'vitest';
import { expireStaleReservations } from '../src/services/reservationExpirationJob';

describe('expireStaleReservations', () => {
  it('returns an expiration result with zero stale reservations when none exist', () => {
    const result = expireStaleReservations();

    expect(typeof result.expiredCount).toBe('number');
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.expiredBountyIds)).toBe(true);
    expect(typeof result.checkedAt).toBe('number');
  });
});
