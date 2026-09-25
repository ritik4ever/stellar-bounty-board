import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import {
  getAllowedTokenSymbols,
  zodErrorMessage,
  createBountySchema,
  reserveBountySchema,
  submitBountySchema,
  disputeBountySchema,
  resolveDisputeBountySchema,
  maintainerActionSchema,
  updateNotesSchema,
  extendDeadlineSchema,
  bountyIdSchema,
  GITHUB_PR_URL_REGEX,
} from '../src/validation/schemas';
import { githubPrUrlSchema, extractGithubPrRepo } from '../src/validation/prUrl';

// Valid Stellar address for testing
const VALID_STELLAR_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const VALID_TX_HASH = 'a'.repeat(64);

describe('Validation Module — schemas', () => {
  describe('getAllowedTokenSymbols', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns symbols from ALLOWED_TOKEN_SYMBOLS environment variable when set', () => {
      process.env.ALLOWED_TOKEN_SYMBOLS = 'XLM, USDC, TEST';
      const symbols = getAllowedTokenSymbols();
      expect(symbols).toEqual(['XLM', 'USDC', 'TEST']);
    });

    it('trims and uppercases symbols from ALLOWED_TOKEN_SYMBOLS', () => {
      process.env.ALLOWED_TOKEN_SYMBOLS = '  xlm  ,  usdc  ';
      const symbols = getAllowedTokenSymbols();
      expect(symbols).toEqual(['XLM', 'USDC']);
    });

    it('filters out empty entries from ALLOWED_TOKEN_SYMBOLS', () => {
      process.env.ALLOWED_TOKEN_SYMBOLS = 'XLM,,USDC,';
      const symbols = getAllowedTokenSymbols();
      expect(symbols).toEqual(['XLM', 'USDC']);
    });

    it('falls back to token address map when ALLOWED_TOKEN_SYMBOLS is not set', () => {
      delete process.env.ALLOWED_TOKEN_SYMBOLS;
      const symbols = getAllowedTokenSymbols();
      expect(Array.isArray(symbols)).toBe(true);
      expect(symbols.length).toBeGreaterThan(0);
    });

    it('returns empty-string entries filtered from result', () => {
      process.env.ALLOWED_TOKEN_SYMBOLS = '   ,   ';
      const symbols = getAllowedTokenSymbols();
      // After filtering empty, should fall back to token address map
      expect(Array.isArray(symbols)).toBe(true);
    });
  });

  describe('zodErrorMessage', () => {
    it('formats a single validation error with path and message', () => {
      const schema = z.object({ name: z.string().min(5) });
      const result = schema.safeParse({ name: 'ab' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = zodErrorMessage(result.error);
        expect(msg).toContain('name');
        expect(msg).toContain('at least 5 character');
      }
    });

    it('joins multiple errors with semicolon separator', () => {
      const schema = z.object({
        name: z.string().min(5),
        age: z.number().positive(),
      });
      const result = schema.safeParse({ name: 'ab', age: -1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = zodErrorMessage(result.error);
        expect(msg).toContain(';');
        expect(msg).toContain('name');
        expect(msg).toContain('age');
      }
    });

    it('uses "body" as path when issue has empty path', () => {
      const schema = z.string().min(5);
      const result = schema.safeParse('ab');
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = zodErrorMessage(result.error);
        expect(msg).toContain('body');
      }
    });

    it('returns empty string for error with no issues', () => {
      // Create a mock error with no issues
      const mockError = new z.ZodError([]);
      const msg = zodErrorMessage(mockError);
      expect(msg).toBe('');
    });

    it('handles errors gracefully even with unusual input', () => {
      // zodErrorMessage expects an array of issues; it will handle missing/null gracefully
      const mockError = new z.ZodError([]);
      expect(() => zodErrorMessage(mockError)).not.toThrow();
    });
  });

  describe('bountyIdSchema', () => {
    it('accepts non-empty bounty IDs', () => {
      const result = bountyIdSchema.safeParse('BNT-0001');
      expect(result.success).toBe(true);
    });

    it('trims whitespace', () => {
      const result = bountyIdSchema.safeParse('  BNT-0001  ');
      expect(result.success).toBe(true);
      expect(result.data).toBe('BNT-0001');
    });

    it('rejects empty strings', () => {
      const result = bountyIdSchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('rejects only-whitespace strings', () => {
      const result = bountyIdSchema.safeParse('   ');
      expect(result.success).toBe(false);
    });
  });

  describe('createBountySchema', () => {
    const validBody = {
      repo: 'owner/repo',
      issueNumber: 42,
      title: 'Fix login bug',
      summary: 'The login page does not redirect after authentication.',
      maintainer: VALID_STELLAR_ADDRESS,
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 14,
      labels: ['bug'],
    };

    it('accepts a valid create bounty request', () => {
      const result = createBountySchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it('coerces numeric strings to numbers', () => {
      const body = { ...validBody, issueNumber: '42', amount: '100', deadlineDays: '14' };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(true);
      expect(result.data?.issueNumber).toBe(42);
    });

    it('uppercases token symbol', () => {
      const body = { ...validBody, tokenSymbol: 'xlm' };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(true);
      expect(result.data?.tokenSymbol).toBe('XLM');
    });

    it('rejects invalid repo format', () => {
      const body = { ...validBody, repo: 'invalid-repo-format' };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects non-positive issue numbers', () => {
      const body = { ...validBody, issueNumber: 0 };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects title shorter than 5 chars', () => {
      const body = { ...validBody, title: 'Fix' };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects title longer than 120 chars', () => {
      const body = { ...validBody, title: 'a'.repeat(121) };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects summary shorter than 20 chars', () => {
      const body = { ...validBody, summary: 'too short' };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects summary longer than 280 chars', () => {
      const body = { ...validBody, summary: 'a'.repeat(281) };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects non-positive amount', () => {
      const body = { ...validBody, amount: 0 };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects deadline less than 1 day', () => {
      const body = { ...validBody, deadlineDays: 0 };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects deadline more than 90 days', () => {
      const body = { ...validBody, deadlineDays: 91 };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('defaults labels to empty array', () => {
      const body = { ...validBody };
      delete (body as any).labels;
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(true);
      expect(result.data?.labels).toEqual([]);
    });

    it('rejects more than 6 labels', () => {
      const body = { ...validBody, labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects invalid Stellar address', () => {
      const body = { ...validBody, maintainer: 'not-a-stellar-address' };
      const result = createBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('reserveBountySchema', () => {
    it('accepts a valid reserve bounty request', () => {
      const body = { contributor: VALID_STELLAR_ADDRESS };
      const result = reserveBountySchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    it('accepts optional expectedVersion', () => {
      const body = { contributor: VALID_STELLAR_ADDRESS, expectedVersion: 5 };
      const result = reserveBountySchema.safeParse(body);
      expect(result.success).toBe(true);
      expect(result.data?.expectedVersion).toBe(5);
    });

    it('rejects non-integer expectedVersion', () => {
      const body = { contributor: VALID_STELLAR_ADDRESS, expectedVersion: 5.5 };
      const result = reserveBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('submitBountySchema', () => {
    const validBody = {
      contributor: VALID_STELLAR_ADDRESS,
      submissionUrl: 'https://github.com/owner/repo/pull/123',
    };

    it('accepts a valid submit bounty request', () => {
      const result = submitBountySchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it('accepts optional notes', () => {
      const body = { ...validBody, notes: 'Fixed the issue' };
      const result = submitBountySchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    it('rejects notes longer than 240 chars', () => {
      const body = { ...validBody, notes: 'a'.repeat(241) };
      const result = submitBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects invalid URL', () => {
      const body = { ...validBody, submissionUrl: 'not-a-url' };
      const result = submitBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('disputeBountySchema', () => {
    const validBody = {
      contributor: VALID_STELLAR_ADDRESS,
      reason: 'The submission was not reviewed within the agreed timeframe.',
    };

    it('accepts a valid dispute request', () => {
      const result = disputeBountySchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it('rejects empty reason', () => {
      const body = { ...validBody, reason: '' };
      const result = disputeBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects reason longer than 500 chars', () => {
      const body = { ...validBody, reason: 'a'.repeat(501) };
      const result = disputeBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('resolveDisputeBountySchema', () => {
    const validBody = {
      arbiter: VALID_STELLAR_ADDRESS,
      release: true,
    };

    it('accepts a valid resolve dispute request without transaction hash', () => {
      const result = resolveDisputeBountySchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it('accepts with optional transaction hash', () => {
      const body = { ...validBody, transactionHash: VALID_TX_HASH };
      const result = resolveDisputeBountySchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    it('rejects invalid transaction hash', () => {
      const body = { ...validBody, transactionHash: 'not-a-valid-hash' };
      const result = resolveDisputeBountySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('allows release: false', () => {
      const body = { ...validBody, release: false };
      const result = resolveDisputeBountySchema.safeParse(body);
      expect(result.success).toBe(true);
    });
  });

  describe('maintainerActionSchema', () => {
    const validBody = {
      maintainer: VALID_STELLAR_ADDRESS,
    };

    it('accepts a valid maintainer action request', () => {
      const result = maintainerActionSchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it('accepts optional transaction hash', () => {
      const body = { ...validBody, transactionHash: VALID_TX_HASH };
      const result = maintainerActionSchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    it('rejects invalid transaction hash', () => {
      const body = { ...validBody, transactionHash: 'invalid' };
      const result = maintainerActionSchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('requires exactly 64 hex characters in transaction hash', () => {
      const body = { ...validBody, transactionHash: VALID_TX_HASH + 'a' };
      const result = maintainerActionSchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('updateNotesSchema', () => {
    const validBody = {
      maintainer: VALID_STELLAR_ADDRESS,
      notes: 'Updated bounty notes',
    };

    it('accepts a valid update notes request', () => {
      const result = updateNotesSchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it('accepts empty notes', () => {
      const body = { ...validBody, notes: '' };
      const result = updateNotesSchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    it('rejects notes longer than 2000 chars', () => {
      const body = { ...validBody, notes: 'a'.repeat(2001) };
      const result = updateNotesSchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('extendDeadlineSchema', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days from now

    const validBody = {
      maintainer: VALID_STELLAR_ADDRESS,
      newDeadline: futureTimestamp,
    };

    it('accepts a valid extend deadline request', () => {
      const result = extendDeadlineSchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it('rejects non-integer deadline', () => {
      const body = { ...validBody, newDeadline: futureTimestamp + 0.5 };
      const result = extendDeadlineSchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects non-positive deadline', () => {
      const body = { ...validBody, newDeadline: 0 };
      const result = extendDeadlineSchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('GITHUB_PR_URL_REGEX constant', () => {
    it('matches valid GitHub PR URLs', () => {
      const urls = [
        'https://github.com/owner/repo/pull/123',
        'https://github.com/owner-name/repo-name/pull/999',
        'https://github.com/o/r/pull/1',
      ];
      urls.forEach((url) => {
        expect(GITHUB_PR_URL_REGEX.test(url)).toBe(true);
      });
    });

    it('rejects URLs with query strings or fragments', () => {
      expect(GITHUB_PR_URL_REGEX.test('https://github.com/owner/repo/pull/123?query=1')).toBe(false);
      expect(GITHUB_PR_URL_REGEX.test('https://github.com/owner/repo/pull/123#anchor')).toBe(false);
    });

    it('rejects URLs with extra path segments', () => {
      expect(GITHUB_PR_URL_REGEX.test('https://github.com/owner/repo/pull/123/files')).toBe(false);
    });

    it('rejects non-GitHub URLs', () => {
      expect(GITHUB_PR_URL_REGEX.test('https://gitlab.com/owner/repo/pull/123')).toBe(false);
    });
  });
});

describe('Validation Module — githubPrUrlSchema', () => {
  it('accepts valid GitHub PR URL', () => {
    const result = githubPrUrlSchema.safeParse('https://github.com/owner/repo/pull/123');
    expect(result.success).toBe(true);
  });

  it('trims whitespace from input', () => {
    const result = githubPrUrlSchema.safeParse('  https://github.com/owner/repo/pull/123  ');
    expect(result.success).toBe(true);
  });

  it('rejects URLs from github.com', () => {
    const result = githubPrUrlSchema.safeParse('https://www.github.com/owner/repo/pull/123');
    expect(result.success).toBe(false);
  });

  it('rejects URLs without /pull/ segment', () => {
    const result = githubPrUrlSchema.safeParse('https://github.com/owner/repo/issues/123');
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric PR numbers', () => {
    const result = githubPrUrlSchema.safeParse('https://github.com/owner/repo/pull/abc');
    expect(result.success).toBe(false);
  });

  it('rejects non-URL strings', () => {
    const result = githubPrUrlSchema.safeParse('not a url');
    expect(result.success).toBe(false);
  });

  it('rejects http (non-https) URLs', () => {
    const result = githubPrUrlSchema.safeParse('http://github.com/owner/repo/pull/123');
    expect(result.success).toBe(false);
  });

  it('rejects URLs with query strings', () => {
    const result = githubPrUrlSchema.safeParse('https://github.com/owner/repo/pull/123?diff');
    expect(result.success).toBe(false);
  });
});

describe('Validation Module — extractGithubPrRepo', () => {
  it('extracts owner/repo from valid PR URL', () => {
    const repo = extractGithubPrRepo('https://github.com/owner/repo/pull/123');
    expect(repo).toBe('owner/repo');
  });

  it('returns undefined for non-github.com URLs', () => {
    const repo = extractGithubPrRepo('https://gitlab.com/owner/repo/pull/123');
    expect(repo).toBeUndefined();
  });

  it('returns undefined when /pull/ segment missing', () => {
    const repo = extractGithubPrRepo('https://github.com/owner/repo/issues/123');
    expect(repo).toBeUndefined();
  });

  it('preserves case in owner and repo names', () => {
    const repo = extractGithubPrRepo('https://github.com/Owner/Repo/pull/123');
    expect(repo).toBe('Owner/Repo');
  });

  it('throws TypeError for non-URL strings', () => {
    expect(() => extractGithubPrRepo('not-a-url')).toThrow(TypeError);
  });

  it('handles URLs with query strings (ignored)', () => {
    const repo = extractGithubPrRepo('https://github.com/owner/repo/pull/123?param=value');
    expect(repo).toBe('owner/repo');
  });
});
