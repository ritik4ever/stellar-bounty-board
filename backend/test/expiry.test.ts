import { describe, it, expect } from 'vitest';
import { expireStaleReservations } from '../src/services/bountyStore';

describe('expireStaleReservations', () => {
  it('returns a number (0 when no stale reservations)', () => {
    const result = expireStaleReservations();
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
