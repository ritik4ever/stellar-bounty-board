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

  it('status code is 401 (not 500) when the previous secret is revoked after expiry', () => {
    // 401 = client signed with a revoked key; 500 would imply server misconfiguration.
    vi.setSystemTime(startedAt + gracePeriodMs + 1);
    let caught: unknown;
    try {
      checkSignature(previousSecret);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookSignatureError);
    expect((caught as WebhookSignatureError).statusCode).toBe(401);
  });

  it('status code is 500 when newSecret is empty (server misconfiguration, not a bad client request)', () => {
    vi.setSystemTime(startedAt + 1);
    let caught: unknown;
    try {
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload,
        signatureHeader: signWebhookPayload({ payload, secret: newSecret, algorithm: 'sha256', prefix: 'sha256=' }),
        newSecret: '',
        previousSecret,
        rotationStartedAt: startedAt,
        gracePeriodMs,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookSignatureError);
    expect((caught as WebhookSignatureError).statusCode).toBe(500);
  });

  it('gracePeriodMs minimum boundary (1 ms): old secret accepted before expiry, rejected at exact expiry', () => {
    // At startedAt + 0 the window is open.
    vi.setSystemTime(startedAt);
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload,
        signatureHeader: signWebhookPayload({ payload, secret: previousSecret, algorithm: 'sha256', prefix: 'sha256=' }),
        newSecret,
        previousSecret,
        gracePeriodMs: 1,
        rotationStartedAt: startedAt,
      }),
    ).not.toThrow();

    // At startedAt + 1 (the expiry instant) the window is closed.
    vi.setSystemTime(startedAt + 1);
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload,
        signatureHeader: signWebhookPayload({ payload, secret: previousSecret, algorithm: 'sha256', prefix: 'sha256=' }),
        newSecret,
        previousSecret,
        gracePeriodMs: 1,
        rotationStartedAt: startedAt,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it('gracePeriodMs maximum boundary (300_000 ms): old secret accepted at last ms, rejected at exact expiry, exceeded value is 500', () => {
    const MAX = 300_000;

    // Last millisecond inside the maximum window: accepted.
    vi.setSystemTime(startedAt + MAX - 1);
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload,
        signatureHeader: signWebhookPayload({ payload, secret: previousSecret, algorithm: 'sha256', prefix: 'sha256=' }),
        newSecret,
        previousSecret,
        gracePeriodMs: MAX,
        rotationStartedAt: startedAt,
      }),
    ).not.toThrow();

    // Exactly at expiry: rejected (401).
    vi.setSystemTime(startedAt + MAX);
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload,
        signatureHeader: signWebhookPayload({ payload, secret: previousSecret, algorithm: 'sha256', prefix: 'sha256=' }),
        newSecret,
        previousSecret,
        gracePeriodMs: MAX,
        rotationStartedAt: startedAt,
      }),
    ).toThrow(WebhookSignatureError);

    // Exceeding the cap is a misconfiguration: status 500.
    let caught: unknown;
    try {
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload,
        signatureHeader: signWebhookPayload({ payload, secret: newSecret, algorithm: 'sha256', prefix: 'sha256=' }),
        newSecret,
        previousSecret,
        gracePeriodMs: MAX + 1,
        rotationStartedAt: startedAt,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookSignatureError);
    expect((caught as WebhookSignatureError).statusCode).toBe(500);
  });

  it('verifies deterministic overlap and revoked-secret fixtures from a clean environment (#1969)', () => {
    const cleanPayload = Buffer.from(
      JSON.stringify({ action: 'closed', pull_request: { number: 1969, merged: true } }),
      'utf8',
    );
    const oldSig = signWebhookPayload({
      payload: cleanPayload,
      secret: previousSecret,
      algorithm: 'sha256',
      prefix: 'sha256=',
    });
    const newSig = signWebhookPayload({
      payload: cleanPayload,
      secret: newSecret,
      algorithm: 'sha256',
      prefix: 'sha256=',
    });

    // During overlap window: both old and new secret signatures verify
    vi.setSystemTime(startedAt + gracePeriodMs - 1);
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload: cleanPayload,
        signatureHeader: oldSig,
        newSecret,
        previousSecret,
        gracePeriodMs,
        rotationStartedAt: startedAt,
      }),
    ).not.toThrow();
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload: cleanPayload,
        signatureHeader: newSig,
        newSecret,
        previousSecret,
        gracePeriodMs,
        rotationStartedAt: startedAt,
      }),
    ).not.toThrow();

    // At exact expiry: old secret is revoked (401), new secret remains accepted
    vi.setSystemTime(startedAt + gracePeriodMs);
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload: cleanPayload,
        signatureHeader: oldSig,
        newSecret,
        previousSecret,
        gracePeriodMs,
        rotationStartedAt: startedAt,
      }),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyWithSecretRotation({
        ...githubWebhookSignatureProfile,
        payload: cleanPayload,
        signatureHeader: newSig,
        newSecret,
        previousSecret,
        gracePeriodMs,
        rotationStartedAt: startedAt,
      }),
    ).not.toThrow();
  });
});
