import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let storeFile: string;
const testKeypair = Keypair.random();
const testPublicKey = testKeypair.publicKey();

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-jwt-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret-key-123';
  process.env.JWT_EXPIRY = '1h';
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.NODE_ENV;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRY;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    // best-effort
  }
});

async function getApp() {
  const { app } = await import('../src/app');
  return app;
}

describe('JWT Authentication — POST /api/auth/login', () => {
  it('issues a JWT token for a valid Stellar public key', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('expiresIn');
    expect(res.body.token).toBeTruthy();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresIn).toBe('1h');
  });

  it('returns 400 when publicKey is missing', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/publicKey/i);
  });

  it('returns 400 when publicKey format is invalid', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: 'invalid-key' })
      .expect(400);

    expect(res.body.error).toMatch(/stellar|format/i);
  });

  it('returns 400 when publicKey is not a string', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: 12345 })
      .expect(400);

    expect(res.body.error).toMatch(/publicKey/i);
  });
});

describe('JWT Authentication — Bearer token validation', () => {
  it('accepts valid Bearer token in Authorization header', async () => {
    const app = await getApp();

    // First, get a token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const token = loginRes.body.token;

    // Use token to access protected endpoint (refresh)
    const protectedRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(protectedRes.body).toHaveProperty('token');
    expect(protectedRes.body.token).not.toBe(token); // Should be a new token
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/refresh')
      .expect(401);

    expect(res.body.error).toMatch(/missing|authorization/i);
  });

  it('returns 401 when Bearer prefix is incorrect', async () => {
    const app = await getApp();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const token = loginRes.body.token;

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Token ${token}`)
      .expect(401);

    expect(res.body.error).toMatch(/authorization/i);
  });

  it('returns 401 when token is malformed', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .expect(401);

    expect(res.body.error).toMatch(/invalid|token/i);
  });
});

describe('JWT Authentication — POST /api/auth/refresh', () => {
  it('issues a new token when given a valid JWT', async () => {
    const app = await getApp();

    // Get initial token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const oldToken = loginRes.body.token;

    // Refresh the token
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(200);

    expect(refreshRes.body).toHaveProperty('token');
    expect(refreshRes.body.token).not.toBe(oldToken);
    expect(refreshRes.body.expiresIn).toBe('1h');
  });

  it('returns 401 when token is expired', async () => {
    const app = await getApp();

    // Create a token with very short expiry
    process.env.JWT_EXPIRY = '0s'; // Expired immediately
    vi.resetModules();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const expiredToken = loginRes.body.token;

    // Wait a moment to ensure expiration
    await new Promise(resolve => setTimeout(resolve, 100));

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(res.body.error).toMatch(/expired|token/i);
  });

  it('preserves the subject (public key) across token refresh', async () => {
    const app = await getApp();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    // Decode the token to check the payload
    const token1 = loginRes.body.token;
    const parts1 = token1.split('.');
    const payload1 = JSON.parse(Buffer.from(parts1[1], 'base64').toString());
    expect(payload1.sub).toBe(testPublicKey);

    // Refresh and check again
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);

    const token2 = refreshRes.body.token;
    const parts2 = token2.split('.');
    const payload2 = JSON.parse(Buffer.from(parts2[1], 'base64').toString());
    expect(payload2.sub).toBe(testPublicKey);
  });

  it('includes issuer claim in JWT', async () => {
    const app = await getApp();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const token = loginRes.body.token;
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    expect(payload.iss).toBe('stellar-bounty-board');
  });

  it('includes expiration claim in JWT', async () => {
    const app = await getApp();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const token = loginRes.body.token;
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    expect(payload.exp).toBeTruthy();
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('JWT Authentication — Token tampering detection', () => {
  it('rejects tokens with tampered payload', async () => {
    const app = await getApp();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const token = loginRes.body.token;
    const parts = token.split('.');

    // Tamper with payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    payload.sub = Keypair.random().publicKey(); // Change the subject
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${tamperedToken}`)
      .expect(401);

    expect(res.body.error).toMatch(/invalid|token/i);
  });

  it('rejects tokens with tampered signature', async () => {
    const app = await getApp();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ publicKey: testPublicKey })
      .expect(200);

    const token = loginRes.body.token;
    const parts = token.split('.');

    // Tamper with signature
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignature`;

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${tamperedToken}`)
      .expect(401);

    expect(res.body.error).toMatch(/invalid|token/i);
  });
});
