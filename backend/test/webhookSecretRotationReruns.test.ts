import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  githubWebhookSignatureProfile,
  signWebhookPayload,
  verifyWithSecretRotation,
  WebhookSignatureError,
} from '../src/webhooks/signatureVerification';

const previousSecret = 'previous-secret-for-deterministic-fixtures';
const newSecret = 'new-secret-for-deterministic-fixtures';
const payload = Buffer.from('{"action":"opened","id":42}', 'utf8');
const startedAt = 1_000_000;
const gracePeriodMs = 300_000;

function checkSignature(secret: string): void {
  verifyWithSecretRotation({
    ...githubWebhookSignatureProfile,
    payload,
    signatureHeader: signWebhookPayload({
      payload,
      secret,
      algorithm: 'sha256',
      prefix: 'sha256=',
    }),
    newSecret,
    previousSecret,
    gracePeriodMs,
    rotationStartedAt: startedAt,
  });
}

describe('GitHub signature verification across repeated rotation checks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('accepts the new signature throughout and after the grace period', () => {
    vi.setSystemTime(startedAt);
    expect(() => checkSignature(newSecret)).not.toThrow();
    vi.setSystemTime(startedAt + gracePeriodMs + 1);
    expect(() => checkSignature(newSecret)).not.toThrow();
  });

  it('accepts the old signature only until the fixed expiry', () => {
    vi.setSystemTime(startedAt + gracePeriodMs - 1);
    expect(() => checkSignature(previousSecret)).not.toThrow();
    vi.setSystemTime(startedAt + gracePeriodMs);
    expect(() => checkSignature(previousSecret)).toThrow(/Invalid GitHub webhook signature/);
    // Re-checking with the same persisted start time does not reopen the window.
    vi.setSystemTime(startedAt + gracePeriodMs + 20_000);
    expect(() => checkSignature(previousSecret)).toThrow(/Invalid GitHub webhook signature/);
  });

  it('rejects signatures when the payload changes', () => {
    vi.setSystemTime(startedAt + 1);
    const signatureHeader = signWebhookPayload({
      payload: Buffer.from('other payload'),
      secret: newSecret,
      algorithm: 'sha256',
      prefix: 'sha256=',
    });
    expect(() => verifyWithSecretRotation({
      ...githubWebhookSignatureProfile,
      payload,
      signatureHeader,
      newSecret,
      previousSecret,
      rotationStartedAt: startedAt,
      gracePeriodMs,
    })).toThrow(/Invalid GitHub webhook signature/);
  });

  it('throws WebhookSignatureError with status 401 when verifying a delivery signed with an expired/revoked secret', () => {
    vi.setSystemTime(startedAt + gracePeriodMs + 100);
    try {
      checkSignature(previousSecret);
      expect.fail('Should have thrown WebhookSignatureError');
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookSignatureError);
      const sigErr = err as WebhookSignatureError;
      expect(sigErr.statusCode).toBe(401);
      expect(sigErr.message).toBe('Invalid GitHub webhook signature.');
    }
  });

  it('preserves valid verification for active secret while revoked secret is rejected simultaneously', () => {
    vi.setSystemTime(startedAt + gracePeriodMs + 500);
    // Active secret signature passes
    expect(() => checkSignature(newSecret)).not.toThrow();
    // Revoked previous secret signature fails closed
    expect(() => checkSignature(previousSecret)).toThrow(WebhookSignatureError);
  });
});
