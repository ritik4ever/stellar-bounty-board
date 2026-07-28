import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { logger } from '../src/logger';
import {
  createIpReputationAntiSpamMiddleware,
  createInMemoryAntiSpamDetector,
  createLocalBlocklistIpChecker,
  getClientIp,
  type AntiSpamDetector,
  type IpReputationChecker,
  type IpReputationResult,
} from '../src/middleware/ipReputationAntiSpam';

type WarnPayload = Record<string, unknown>;

function buildApp(
  middleware: ReturnType<typeof createIpReputationAntiSpamMiddleware>
): Express {
  const app = express();
  app.use(express.json());
  app.post('/api/bounties', middleware, (req, res) => {
    res.status(201).json({ data: { id: 'BNT-test', title: req.body.title } });
  });
  return app;
}

function fakeChecker(result: IpReputationResult): IpReputationChecker {
  return {
    checkIp: vi.fn(async (): Promise<IpReputationResult> => result),
  };
}

function alwaysOk(): IpReputationChecker {
  return fakeChecker({ isFlagged: false, source: 'none' });
}

function alwaysFlagged(): IpReputationChecker {
  return fakeChecker({ isFlagged: true, source: 'local_blocklist', reason: 'test_block' });
}

function failingChecker(): IpReputationChecker {
  return {
    checkIp: vi.fn(async (): Promise<IpReputationResult> => {
      throw new Error('reputation service down');
    }),
  };
}

function freshDetector(): AntiSpamDetector {
  return createInMemoryAntiSpamDetector(60, 1000);
}

const sampleBody = {
  repo: 'owner/repo',
  issueNumber: 1,
  title: 'Fix the annoying login redirect bug on mobile',
  summary: 'The mobile login flow does not redirect back after auth, causing a blank screen for users.',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'XLM',
  amount: 10,
  deadlineDays: 14,
};

describe('getClientIp', () => {
  it('uses the first X-Forwarded-For hop when present', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as never;
    expect(getClientIp(req)).toBe('203.0.113.5');
  });

  it('falls back to req.ip when no X-Forwarded-For', () => {
    const req = {
      headers: {},
      ip: '192.0.2.9',
      socket: { remoteAddress: '192.0.2.9' },
    } as never;
    expect(getClientIp(req)).toBe('192.0.2.9');
  });

  it('falls back to socket.remoteAddress when req.ip missing', () => {
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: '198.51.100.3' },
    } as never;
    expect(getClientIp(req)).toBe('198.51.100.3');
  });

  it('returns a sentinel when nothing is available', () => {
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: undefined },
    } as never;
    expect(getClientIp(req)).toBe('0.0.0.0');
  });
});

describe('createInMemoryAntiSpamDetector', () => {
  let detector: AntiSpamDetector;

  beforeEach(() => {
    detector = createInMemoryAntiSpamDetector(2, 1000);
  });

  it('flags an identical title repeated within the window', () => {
    detector.recordRequest('1.1.1.1', 'hello world', 'desc one');
    const result = detector.checkSpam('1.1.1.1', 'hello world', 'different desc');
    expect(result.isSpam).toBe(true);
    expect(result.matchedTitle).toBe('hello world');
  });

  it('flags an identical description repeated within the window', () => {
    const longDesc = 'a sufficiently long description that should match exactly';
    detector.recordRequest('2.2.2.2', 'unique title a', longDesc);
    const result = detector.checkSpam('2.2.2.2', 'entirely different title', longDesc);
    expect(result.isSpam).toBe(true);
    expect(result.matchedDescription).toBe(longDesc);
  });

  it('is case-insensitive and ignores leading/trailing whitespace', () => {
    detector.recordRequest('3.3.3.3', '  Hello World  ', 'desc');
    const result = detector.checkSpam('3.3.3.3', 'hello world', 'desc');
    expect(result.isSpam).toBe(true);
  });

  it('does not flag across different IPs', () => {
    detector.recordRequest('1.1.1.1', 'same title', 'desc');
    const result = detector.checkSpam('2.2.2.2', 'same title', 'desc');
    expect(result.isSpam).toBe(false);
  });

  it('does not flag short descriptions as duplicate-content', () => {
    detector.recordRequest('4.4.4.4', 'title', 'short');
    const result = detector.checkSpam('4.4.4.4', 'other', 'short');
    expect(result.isSpam).toBe(false);
  });

  it('evicts entries once the window elapses', () => {
    vi.useFakeTimers();
    detector.recordRequest('5.5.5.5', 'repeat me', 'desc');
    // window is 2 seconds
    vi.advanceTimersByTime(2_001);
    const result = detector.checkSpam('5.5.5.5', 'repeat me', 'desc');
    expect(result.isSpam).toBe(false);
    vi.useRealTimers();
  });

  it('enforces the maxEntries bound, evicting oldest first', () => {
    const tiny = createInMemoryAntiSpamDetector(60, 2);
    tiny.recordRequest('a', 'title a', 'desc a');
    tiny.recordRequest('b', 'title b', 'desc b');
    // third insert evicts 'a'
    tiny.recordRequest('c', 'title c', 'desc c');
    expect(tiny.checkSpam('a', 'title a', 'desc a').isSpam).toBe(false);
    expect(tiny.checkSpam('b', 'title b', 'desc b').isSpam).toBe(true);
  });

  it('cleanup() prunes expired entries', () => {
    vi.useFakeTimers();
    detector.recordRequest('6.6.6.6', 'old', 'desc');
    vi.advanceTimersByTime(3_000);
    detector.cleanup();
    expect(detector.checkSpam('6.6.6.6', 'old', 'desc').isSpam).toBe(false);
    vi.useRealTimers();
  });
});

describe('createLocalBlocklistIpChecker', () => {
  afterEach(() => {
    delete process.env.IP_REPUTATION_BLOCKLIST;
    delete process.env.IP_REPUTATION_ALLOWLIST;
  });

  it('flags an exact-match IP from the blocklist', async () => {
    process.env.IP_REPUTATION_BLOCKLIST = '203.0.113.10';
    const checker = createLocalBlocklistIpChecker();
    const result = await checker.checkIp('203.0.113.10');
    expect(result).toEqual({ isFlagged: true, source: 'local_blocklist', reason: 'ip_matches_local_blocklist' });
  });

  it('flags an IP inside a blocked CIDR', async () => {
    process.env.IP_REPUTATION_BLOCKLIST = '198.51.100.0/24';
    const checker = createLocalBlocklistIpChecker();
    const result = await checker.checkIp('198.51.100.42');
    expect(result.isFlagged).toBe(true);
  });

  it('does not flag an IP outside a blocked CIDR', async () => {
    process.env.IP_REPUTATION_BLOCKLIST = '198.51.100.0/24';
    const checker = createLocalBlocklistIpChecker();
    const result = await checker.checkIp('198.51.101.1');
    expect(result.isFlagged).toBe(false);
  });

  it('allowlist overrides the blocklist', async () => {
    process.env.IP_REPUTATION_BLOCKLIST = '198.51.100.0/24';
    process.env.IP_REPUTATION_ALLOWLIST = '198.51.100.42';
    const checker = createLocalBlocklistIpChecker();
    const result = await checker.checkIp('198.51.100.42');
    expect(result.isFlagged).toBe(false);
  });

  it('handles a /0 CIDR (flags everything)', async () => {
    process.env.IP_REPUTATION_BLOCKLIST = '0.0.0.0/0';
    const checker = createLocalBlocklistIpChecker();
    const result = await checker.checkIp('8.8.8.8');
    expect(result.isFlagged).toBe(true);
  });

  it('returns not flagged when no lists configured', async () => {
    const checker = createLocalBlocklistIpChecker();
    const result = await checker.checkIp('1.2.3.4');
    expect(result).toEqual({ isFlagged: false, source: 'none' });
  });

  it('ignores malformed CIDR patterns gracefully', async () => {
    process.env.IP_REPUTATION_BLOCKLIST = 'not-an-ip, 198.51.100.0/abc';
    const checker = createLocalBlocklistIpChecker();
    const result = await checker.checkIp('198.51.100.5');
    expect(result.isFlagged).toBe(false);
  });
});

describe('createIpReputationAntiSpamMiddleware — log-only mode', () => {
  let app: Express;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const middleware = createIpReputationAntiSpamMiddleware(
      { enforceMode: false, ipCheckEnabled: true },
      { ipChecker: alwaysFlagged(), spamDetector: freshDetector() }
    );
    app = buildApp(middleware);
  });

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('logs a flagged request but still returns 201 in log-only mode', async () => {
    const res = await request(app).post('/api/bounties').send(sampleBody).expect(201);
    expect(res.body.data.id).toBe('BNT-test');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = warnSpy.mock.calls[0][0] as WarnPayload;
    expect(payload.flag).toBe('ip_reputation_anti_spam');
    expect(payload.ipReputation).toMatchObject({ isFlagged: true });
    expect(payload.enforceMode).toBe(false);
    expect(warnSpy.mock.calls[0][1]).toBe('flagged_bounty_creation');
  });

  it('passes through with no logging for clean traffic', async () => {
    const localWarn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        { enforceMode: false },
        { ipChecker: alwaysOk(), spamDetector: freshDetector() }
      );
      const localApp = buildApp(middleware);
      await request(localApp).post('/api/bounties').send(sampleBody).expect(201);
      expect(localWarn).not.toHaveBeenCalled();
    } finally {
      localWarn.mockRestore();
    }
  });
});

describe('createIpReputationAntiSpamMiddleware — enforce mode', () => {
  it('rejects a flagged IP with 403 in enforce mode', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        { enforceMode: true, ipCheckEnabled: true },
        { ipChecker: alwaysFlagged(), spamDetector: freshDetector() }
      );
      const app = buildApp(middleware);
      const res = await request(app).post('/api/bounties').send(sampleBody).expect(403);
      expect(res.body.error).toMatch(/flagged/i);
      expect(res.body.reason).toBeDefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects duplicate content with 403 in enforce mode', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const detector = freshDetector();
      const middleware = createIpReputationAntiSpamMiddleware(
        { enforceMode: true, ipCheckEnabled: false },
        { ipChecker: alwaysOk(), spamDetector: detector }
      );
      const app = buildApp(middleware);
      await request(app).post('/api/bounties').send(sampleBody).expect(201);
      const res = await request(app).post('/api/bounties').send(sampleBody).expect(403);
      expect(res.body.error).toMatch(/flagged/i);
      expect(res.body.reason).toMatch(/spam/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('allows distinct content in enforce mode', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        { enforceMode: true, ipCheckEnabled: false },
        { ipChecker: alwaysOk(), spamDetector: freshDetector() }
      );
      const app = buildApp(middleware);
      await request(app).post('/api/bounties')
        .set('X-Forwarded-For', '1.1.1.1')
        .send({ ...sampleBody, title: 'a new unique title for bounty one', summary: 'first unique summary body for safety' })
        .expect(201);
      await request(app).post('/api/bounties')
        .set('X-Forwarded-For', '1.1.1.1')
        .send({ ...sampleBody, title: 'a different title for bounty two', summary: 'second distinct summary text here and now' })
        .expect(201);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('createIpReputationAntiSpamMiddleware — error handling', () => {
  it('logs an error and lets the request through when the IP checker throws', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        { enforceMode: true, ipCheckEnabled: true },
        { ipChecker: failingChecker(), spamDetector: freshDetector() }
      );
      const app = buildApp(middleware);
      await request(app).post('/api/bounties').send(sampleBody).expect(201);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][1]).toBe('ip_reputation_check_failed');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('createIpReputationAntiSpamMiddleware — non-POST passthrough', () => {
  it('does not run on GET requests', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        { enforceMode: true },
        { ipChecker: alwaysFlagged(), spamDetector: freshDetector() }
      );
      const app = express();
      app.use(express.json());
      app.get('/api/bounties', middleware, (_req, res) => res.json({ ok: true }));
      await request(app).get('/api/bounties').expect(200);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('createIpReputationAntiSpamMiddleware — env resolution', () => {
  afterEach(() => {
    delete process.env.IP_REPUTATION_ENFORCE;
    delete process.env.IP_REPUTATION_SPAM_WINDOW_SECONDS;
    delete process.env.IP_REPUTATION_IP_CHECK_ENABLED;
    delete process.env.IP_REPUTATION_MAX_ENTRIES;
  });

  it('honours IP_REPUTATION_ENFORCE env var', async () => {
    process.env.IP_REPUTATION_ENFORCE = 'true';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        undefined,
        { ipChecker: alwaysFlagged(), spamDetector: freshDetector() }
      );
      const app = buildApp(middleware);
      await request(app).post('/api/bounties').send(sampleBody).expect(403);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('ignores malformed env values and stays in log-only mode', async () => {
    process.env.IP_REPUTATION_ENFORCE = 'maybe';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        undefined,
        { ipChecker: alwaysFlagged(), spamDetector: freshDetector() }
      );
      const app = buildApp(middleware);
      await request(app).post('/api/bounties').send(sampleBody).expect(201);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('disables IP checking when IP_REPUTATION_IP_CHECK_ENABLED=false', async () => {
    process.env.IP_REPUTATION_IP_CHECK_ENABLED = 'false';
    const checker = alwaysFlagged();
    const checkIpSpy = checker.checkIp as unknown as ReturnType<typeof vi.fn>;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      const middleware = createIpReputationAntiSpamMiddleware(
        { enforceMode: true },
        { ipChecker: checker, spamDetector: freshDetector() }
      );
      const app = buildApp(middleware);
      await request(app).post('/api/bounties').send(sampleBody).expect(201);
      expect(checkIpSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
