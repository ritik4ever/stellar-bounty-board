import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  ServiceDependencyError,
  wrapServiceError,
} from '../../src/services/errors';
import { createTerminalErrorHandler } from '../../src/middleware/errors';

describe('services/errors unit tests (#1302)', () => {
  describe('ServiceDependencyError class', () => {
    it('sets expected defaults for json-store dependency', () => {
      const originalCause = new Error('ENOENT: no such file or directory');
      const error = new ServiceDependencyError({
        operation: 'bounty_store.read_store',
        dependency: 'json-store',
        cause: originalCause,
      });

      expect(error.name).toBe('ServiceDependencyError');
      expect(error.operation).toBe('bounty_store.read_store');
      expect(error.dependency).toBe('json-store');
      expect(error.statusCode).toBe(500);
      expect(error.publicMessage).toBe('Failed to access persistent data store.');
      expect(error.cause).toBe(originalCause);
      expect(error.message).toContain('bounty_store.read_store failed (json-store)');
    });

    it('sets expected defaults for github-api dependency', () => {
      const originalCause = new Error('fetch failed ECONNREFUSED');
      const error = new ServiceDependencyError({
        operation: 'open_issues.fetch_github',
        dependency: 'github-api',
        cause: originalCause,
      });

      expect(error.statusCode).toBe(502);
      expect(error.publicMessage).toBe('GitHub issues service is temporarily unavailable.');
      expect(error.cause).toBe(originalCause);
    });

    it('sets expected defaults for soroban-rpc dependency', () => {
      const originalCause = new Error('RPC timeout');
      const error = new ServiceDependencyError({
        operation: 'contract.submit_transaction',
        dependency: 'soroban-rpc',
        cause: originalCause,
      });

      expect(error.statusCode).toBe(502);
      expect(error.publicMessage).toBe('Stellar network service is temporarily unavailable.');
      expect(error.cause).toBe(originalCause);
    });

    it('preserves custom statusCode and publicMessage when provided', () => {
      const error = new ServiceDependencyError({
        operation: 'bounty_store.lock',
        dependency: 'file-lock',
        statusCode: 503,
        publicMessage: 'Service busy, please retry.',
        cause: new Error('ELOCKED'),
      });

      expect(error.statusCode).toBe(503);
      expect(error.publicMessage).toBe('Service busy, please retry.');
    });
  });

  describe('wrapServiceError helper', () => {
    it('wraps a raw error into ServiceDependencyError preserving the cause', () => {
      const rawError = new TypeError('Cannot read property of undefined');
      const wrapped = wrapServiceError('test.operation', 'json-store', rawError);

      expect(wrapped).toBeInstanceOf(ServiceDependencyError);
      expect(wrapped.cause).toBe(rawError);
      expect(wrapped.operation).toBe('test.operation');
      expect(wrapped.dependency).toBe('json-store');
    });

    it('returns the same instance if error is already a ServiceDependencyError', () => {
      const first = new ServiceDependencyError({
        operation: 'op.first',
        dependency: 'json-store',
        cause: new Error('original'),
      });
      const second = wrapServiceError('op.second', 'github-api', first);

      expect(second).toBe(first);
      expect(second.operation).toBe('op.first');
    });
  });

  describe('HTTP error response sanitization (no raw dependency leakage)', () => {
    it('catches ServiceDependencyError and returns sanitized client response', async () => {
      const app = express();
      app.get('/test-raw-failure', () => {
        throw new ServiceDependencyError({
          operation: 'bounty_store.read_store',
          dependency: 'json-store',
          publicMessage: 'Failed to access persistent data store.',
          cause: new Error('ENOENT: C:\\sensitive\\internal\\bounties.json missing'),
        });
      });
      app.use(createTerminalErrorHandler());

      const res = await request(app).get('/test-raw-failure');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'Failed to access persistent data store.',
      });
      expect(JSON.stringify(res.body)).not.toContain('ENOENT');
      expect(JSON.stringify(res.body)).not.toContain('sensitive');
      expect(JSON.stringify(res.body)).not.toContain('bounties.json');
    });

    it('catches GitHub API dependency failure and returns 502 without stack leakage', async () => {
      const app = express();
      app.get('/test-github-failure', () => {
        throw wrapServiceError(
          'open_issues.fetch_github',
          'github-api',
          new Error('socket hang up at https://api.github.com/secret/token'),
          'GitHub issues service is temporarily unavailable.',
          502
        );
      });
      app.use(createTerminalErrorHandler());

      const res = await request(app).get('/test-github-failure');
      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        error: 'GitHub issues service is temporarily unavailable.',
      });
      expect(JSON.stringify(res.body)).not.toContain('socket hang up');
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });
  });
});
