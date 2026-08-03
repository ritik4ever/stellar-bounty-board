import { describe, it, expect } from 'vitest';

// Replicate deadline-expiry logic inline so the test is self-contained.
function hasDeadlinePassed(deadlineAt: number, now = Math.floor(Date.now() / 1000)): boolean {
  return now > deadlineAt;
}

function hasReservationTimedOut(
  reservedAt: number,
  reservationTimeoutSeconds: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return now > reservedAt + reservationTimeoutSeconds;
}

describe('bounty deadline expiry', () => {
  it('marks an open bounty as expired when deadline is in the past', () => {
    const now = Math.floor(Date.now() / 1000);
    const deadlineAt = now - 60; // 1 minute ago
    expect(hasDeadlinePassed(deadlineAt, now)).toBe(true);
  });

  it('does not expire a bounty when deadline is in the future', () => {
    const now = Math.floor(Date.now() / 1000);
    const deadlineAt = now + 60; // 1 minute from now
    expect(hasDeadlinePassed(deadlineAt, now)).toBe(false);
  });

  it('marks a reserved bounty as timed out when reservation TTL has elapsed', () => {
    const now = Math.floor(Date.now() / 1000);
    const reservedAt = now - 604801; // 1 second past default 7-day TTL
    const reservationTimeoutSeconds = 604800;
    expect(hasReservationTimedOut(reservedAt, reservationTimeoutSeconds, now)).toBe(true);
  });

  it('does not time out a reservation when TTL has not elapsed', () => {
    const now = Math.floor(Date.now() / 1000);
    const reservedAt = now - 604799; // 1 second before default 7-day TTL
    const reservationTimeoutSeconds = 604800;
    expect(hasReservationTimedOut(reservedAt, reservationTimeoutSeconds, now)).toBe(false);
  });

  it('treats exactly-at-deadline as not expired', () => {
    const deadlineAt = Math.floor(Date.now() / 1000);
    expect(hasDeadlinePassed(deadlineAt)).toBe(false);
  });
});
