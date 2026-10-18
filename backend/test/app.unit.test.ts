import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  resolveRequestId,
  parsePaginationValue,
  validateBountyAmount,
  escapeCsv,
  jsonError,
  sendError,
} from '../src/app';
import { ServiceDependencyError } from '../src/services/errors';
import { MiddlewareDependencyError, INTERNAL_ERROR_MESSAGE } from '../src/middleware/errors';

describe('app.ts unit test suite (#1296)', () => {
  describe('resolveRequestId', () => {
    it('returns trimmed valid x-request-id when provided', () => {
      const req = {
        headers: { 'x-request-id': '  my-custom-request-id-123  ' },
      } as unknown as Request;

      expect(resolveRequestId(req)).toBe('my-custom-request-id-123');
    });

    it('generates a new UUID when header is absent', () => {
      const req = { headers: {} } as unknown as Request;
      const id = resolveRequestId(req);

      expect(typeof id).toBe('string');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('generates a new UUID when header contains invalid characters', () => {
      const req = {
        headers: { 'x-request-id': '<script>alert(1)</script>' },
      } as unknown as Request;
      const id = resolveRequestId(req);

      expect(id).not.toContain('<script>');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('generates a new UUID when header exceeds 128 characters', () => {
      const longHeader = 'a'.repeat(129);
      const req = {
        headers: { 'x-request-id': longHeader },
      } as unknown as Request;
      const id = resolveRequestId(req);

      expect(id).not.toBe(longHeader);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('parsePaginationValue', () => {
    it('returns defaultValue when value is undefined, null, or empty string', () => {
      expect(parsePaginationValue(undefined, 'limit', 20, 1, 100)).toBe(20);
      expect(parsePaginationValue(null, 'limit', 20, 1, 100)).toBe(20);
      expect(parsePaginationValue('', 'limit', 20, 1, 100)).toBe(20);
    });

    it('parses valid integer strings', () => {
      expect(parsePaginationValue('50', 'limit', 20, 1, 100)).toBe(50);
      expect(parsePaginationValue(['35'], 'limit', 20, 1, 100)).toBe(35);
    });

    it('throws error when value is not an integer', () => {
      expect(() => parsePaginationValue('abc', 'limit', 20, 1, 100)).toThrow(
        'limit must be an integer.'
      );
      expect(() => parsePaginationValue('12.34', 'limit', 20, 1, 100)).toThrow(
        'limit must be an integer.'
      );
    });

    it('throws error when value is below minimum', () => {
      expect(() => parsePaginationValue('0', 'limit', 20, 1, 100)).toThrow(
        'limit must be greater than or equal to 1.'
      );
    });

    it('throws error when value exceeds maximum', () => {
      expect(() => parsePaginationValue('101', 'limit', 20, 1, 100)).toThrow(
        'limit must be less than or equal to 100.'
      );
    });
  });

  describe('validateBountyAmount', () => {
    it('returns null for valid amounts within bounds', () => {
      expect(validateBountyAmount(1)).toBeNull();
      expect(validateBountyAmount(100)).toBeNull();
      expect(validateBountyAmount(10000)).toBeNull();
      expect(validateBountyAmount(25.1234567)).toBeNull();
    });

    it('returns error when amount is non-finite', () => {
      expect(validateBountyAmount(NaN)).toBe('Amount must be a valid number.');
      expect(validateBountyAmount(Infinity)).toBe('Amount must be a valid number.');
    });

    it('returns error when amount is less than 1 XLM', () => {
      expect(validateBountyAmount(0.99)).toBe('Amount must be at least 1 XLM');
      expect(validateBountyAmount(-5)).toBe('Amount must be at least 1 XLM');
    });

    it('returns error when amount exceeds 10000 XLM', () => {
      expect(validateBountyAmount(10001)).toBe('Amount cannot exceed 10000 XLM');
    });

    it('returns error when amount has more than 7 decimal places', () => {
      expect(validateBountyAmount(10.12345678)).toBe('Amount must have at most 7 decimal places');
    });
  });

  describe('escapeCsv', () => {
    it('returns empty string for null or undefined', () => {
      expect(escapeCsv(null)).toBe('');
      expect(escapeCsv(undefined)).toBe('');
    });

    it('returns unquoted string when no special characters present', () => {
      expect(escapeCsv('Simple string')).toBe('Simple string');
      expect(escapeCsv(12345)).toBe('12345');
    });

    it('quotes string and escapes internal double quotes when needed', () => {
      expect(escapeCsv('Contains, comma')).toBe('"Contains, comma"');
      expect(escapeCsv('Contains "quote"')).toBe('"Contains ""quote"""');
      expect(escapeCsv('Contains\nnewline')).toBe('"Contains\nnewline"');
    });
  });

  describe('jsonError & sendError', () => {
    function mockResponse() {
      const res = {
        statusCode: 200,
        data: null as any,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: any) {
          this.data = payload;
          return this;
        },
      };
      return res as unknown as Response & { statusCode: number; data: any };
    }

    it('jsonError formats response with statusCode and requestId', () => {
      const res = mockResponse();
      const req = { requestId: 'req-abc' } as unknown as Request;

      jsonError(res, req, 400, 'Custom error');
      expect(res.statusCode).toBe(400);
      expect(res.data).toEqual({ error: 'Custom error', requestId: 'req-abc' });
    });

    it('sendError handles ServiceDependencyError cleanly without raw cause leakage', () => {
      const res = mockResponse();
      const req = { requestId: 'req-svc', log: { error: vi.fn() } } as unknown as Request;

      const svcError = new ServiceDependencyError({
        operation: 'bounty_store.read_store',
        dependency: 'json-store',
        cause: new Error('ENOENT: secret file path'),
      });

      sendError(res, req, svcError);
      expect(res.statusCode).toBe(500);
      expect(res.data.error).toBe('Failed to access persistent data store.');
      expect(JSON.stringify(res.data)).not.toContain('ENOENT');
      expect(JSON.stringify(res.data)).not.toContain('secret file path');
    });

    it('sendError sanitizes 500 errors to INTERNAL_ERROR_MESSAGE', () => {
      const res = mockResponse();
      const req = { requestId: 'req-500', log: { error: vi.fn() } } as unknown as Request;

      sendError(res, req, new Error('Database connection crashed'), 500);
      expect(res.statusCode).toBe(500);
      expect(res.data.error).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('sendError detects raw leakage patterns and sanitizes response to 500', () => {
      const res = mockResponse();
      const req = { requestId: 'req-leak', log: { error: vi.fn() } } as unknown as Request;

      sendError(res, req, new Error('ECONNREFUSED 127.0.0.1:5432 at C:\\app\\src\\db.ts:42'), 400);
      expect(res.statusCode).toBe(500);
      expect(res.data.error).toBe(INTERNAL_ERROR_MESSAGE);
      expect(JSON.stringify(res.data)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(res.data)).not.toContain('C:\\app\\src');
    });

    it('sendError passes safe client error messages on 4xx', () => {
      const res = mockResponse();
      const req = { requestId: 'req-client', log: { error: vi.fn() } } as unknown as Request;

      sendError(res, req, new Error('Bounty not found.'), 404);
      expect(res.statusCode).toBe(404);
      expect(res.data.error).toBe('Bounty not found.');
    });
  });
});
