import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  githubWebhookSignatureProfile,
  githubWebhookSignatureSha1Profile,
  signWebhookPayload,
  verifyGitHubWebhookSignature,
  verifyGitHubWebhookSignatureWithNegotiation,
} from '../src/webhooks/signatureVerification';

const secret = 'github-webhook-secret';

interface SearchResultBounty {
  title: string;
}

function createPayloadBuffer(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function createGitHubSignature(payload: Buffer): string {
  return signWebhookPayload({
    payload,
    secret,
    algorithm: githubWebhookSignatureProfile.algorithm,
    prefix: githubWebhookSignatureProfile.prefix,
  });
}

describe('GitHub webhook signature verification', () => {
  it('accepts a valid GitHub signature', () => {
    const payload = createPayloadBuffer({
      action: 'opened',
      repository: { full_name: 'owner/repo' },
    });

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        secret,
        signatureHeader: createGitHubSignature(payload),
      })
    ).not.toThrow();
  });

  it('rejects a missing signature', () => {
    const payload = createPayloadBuffer({ action: 'opened' });

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        secret,
        signatureHeader: undefined,
      })
    ).toThrow(/Missing GitHub webhook signature/i);
  });

  it('rejects an invalid signature', () => {
    const payload = createPayloadBuffer({ action: 'opened' });

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        secret,
        signatureHeader: 'sha256=deadbeef',
      })
    ).toThrow(/Invalid GitHub webhook signature/i);
  });
});

describe('POST /api/webhooks/github', () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    vi.resetModules();
  });

  async function getApp() {
    const { app } = await import('../src/app');
    return app;
  }

  it('rejects requests without a signature', async () => {
    const app = await getApp();

    await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ action: 'opened' }))
      .expect(401);
  });

  it('rejects requests with an invalid signature', async () => {
    const app = await getApp();

    await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=deadbeef')
      .send(JSON.stringify({ action: 'opened' }))
      .expect(401);
  });

  it('accepts requests with a valid signature', async () => {
    const app = await getApp();
    const rawPayload = JSON.stringify({
      action: 'opened',
      number: 42,
      repository: { full_name: 'owner/repo' },
      pull_request: { html_url: 'https://github.com/owner/repo/pull/42' },
    });
    const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    const response = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawPayload)
      .expect(202);

    expect(response.body).toEqual({
      data: {
        authenticated: true,
        provider: 'github',
        received: true,
      },
    });
  });
});

describe('GitHub webhook signature edge cases (#90)', () => {
  it('rejects a signature with wrong prefix', () => {
    const payload = createPayloadBuffer({ action: 'opened' });
    const hmac = createGitHubSignature(payload);
    const wrongPrefix = hmac.replace('sha256=', 'sha1=');

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        secret,
        signatureHeader: wrongPrefix,
      })
    ).toThrow(/Invalid GitHub webhook signature format/i);
  });

  it('rejects when the secret is undefined', () => {
    const payload = createPayloadBuffer({ action: 'opened' });

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        secret: undefined,
        signatureHeader: 'sha256=abc',
      })
    ).toThrow(/Missing GitHub webhook secret/i);
  });

  it('rejects a signature that is the correct length but tampered', () => {
    const payload = createPayloadBuffer({ action: 'opened' });
    const valid = createGitHubSignature(payload);
    const tampered = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        secret,
        signatureHeader: tampered,
      })
    ).toThrow(/Invalid GitHub webhook signature/i);
  });

  it('accepts when the X-Hub-Signature-256 header is an array', () => {
    const payload = createPayloadBuffer({ action: 'opened' });
    const signature = createGitHubSignature(payload);

    expect(() =>
      verifyGitHubWebhookSignature({
        payload,
        secret,
        signatureHeader: [signature, 'sha256=other'],
      })
    ).not.toThrow();
  });
});


describe('Bounty search with ?q= (#85)', () => {
  it('returns all bounties when q is empty', async () => {
    const { listBounties } = await import('../src/services/bountyStore');

    const all = listBounties();
    const withEmpty = listBounties({ q: '' });

    expect(withEmpty.length).toBe(all.length);
  });

  it('filters bounties case-insensitively by title', async () => {
    const { listBounties, createBounty } = await import('../src/services/bountyStore');

    await createBounty({
      repo: 'test/repo',
      issueNumber: 9999,
      title: 'UNIQUE_XYZZY_TITLE',
      summary: 'some description',
      maintainer: 'GAAAA',
      tokenSymbol: 'XLM',
      amount: 10,
      deadlineDays: 30,
      labels: [],
    });

    const results = listBounties({ q: 'xyzzy' });

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((bounty: SearchResultBounty) => bounty.title.toLowerCase().includes('xyzzy'))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue #800 — Algorithm negotiation tests
// ---------------------------------------------------------------------------

describe('verifyGitHubWebhookSignatureWithNegotiation', () => {
  const mockLogger = { warn: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock the logger used inside signatureVerification
    vi.doMock('../src/logger', () => ({ logger: mockLogger }));
  });

  function makeSha256Sig(payload: Buffer): string {
    return signWebhookPayload({
      payload,
      secret,
      algorithm: githubWebhookSignatureProfile.algorithm,
      prefix: githubWebhookSignatureProfile.prefix,
    });
  }

  function makeSha1Sig(payload: Buffer): string {
    return signWebhookPayload({
      payload,
      secret,
      algorithm: githubWebhookSignatureSha1Profile.algorithm,
      prefix: githubWebhookSignatureSha1Profile.prefix,
    });
  }

  it('accepts a valid X-Hub-Signature-256 (SHA-256 preferred path)', () => {
    const payload = createPayloadBuffer({ action: 'opened' });
    const sig256 = makeSha256Sig(payload);

    expect(() =>
      verifyGitHubWebhookSignatureWithNegotiation({
        payload,
        secret,
        headers: { 'x-hub-signature-256': sig256 },
      })
    ).not.toThrow();
  });

  it('accepts a valid X-Hub-Signature (SHA-1 fallback path) and does NOT throw', () => {
    const payload = createPayloadBuffer({ action: 'opened' });
    const sig1 = makeSha1Sig(payload);

    expect(() =>
      verifyGitHubWebhookSignatureWithNegotiation({
        payload,
        secret,
        headers: { 'x-hub-signature': sig1 },
      })
    ).not.toThrow();
  });

  it('prefers SHA-256 over SHA-1 when both headers are present', () => {
    const payload = createPayloadBuffer({ action: 'opened' });
    const sig256 = makeSha256Sig(payload);
    // Deliberately provide a bad SHA-1 sig — it should be ignored
    const badSig1 = 'sha1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    expect(() =>
      verifyGitHubWebhookSignatureWithNegotiation({
        payload,
        secret,
        headers: {
          'x-hub-signature-256': sig256,
          'x-hub-signature': badSig1,
        },
      })
    ).not.toThrow();
  });

  it('rejects an invalid SHA-256 signature even when SHA-1 is also present', () => {
    const payload = createPayloadBuffer({ action: 'opened' });
    const badSig256 = 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const sig1 = makeSha1Sig(payload);

    expect(() =>
      verifyGitHubWebhookSignatureWithNegotiation({
        payload,
        secret,
        headers: {
          'x-hub-signature-256': badSig256,
          'x-hub-signature': sig1,
        },
      })
    ).toThrow(/Invalid GitHub webhook signature/i);
  });

  it('rejects an invalid SHA-1 signature on the fallback path', () => {
    const payload = createPayloadBuffer({ action: 'opened' });

    expect(() =>
      verifyGitHubWebhookSignatureWithNegotiation({
        payload,
        secret,
        headers: { 'x-hub-signature': 'sha1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
      })
    ).toThrow(/Invalid GitHub webhook signature/i);
  });

  it('throws 401 when neither signature header is present', () => {
    const payload = createPayloadBuffer({ action: 'opened' });

    expect(() =>
      verifyGitHubWebhookSignatureWithNegotiation({
        payload,
        secret,
        headers: {},
      })
    ).toThrow(/Missing GitHub webhook signature/i);
  });

  it('throws 401 when only unrelated headers are present', () => {
    const payload = createPayloadBuffer({ action: 'opened' });

    expect(() =>
      verifyGitHubWebhookSignatureWithNegotiation({
        payload,
        secret,
        headers: { 'x-github-event': 'push', 'content-type': 'application/json' },
      })
    ).toThrow(/Missing GitHub webhook signature/i);
  });
});
