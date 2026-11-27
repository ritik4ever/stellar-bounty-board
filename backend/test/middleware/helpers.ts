import type { NextFunction, Request, Response } from "express";
import { vi } from "vitest";

/** Minimal Express request stand-in for calling middleware directly. */
export function mockReq(init: {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  params?: Record<string, string>;
  originalUrl?: string;
  path?: string;
  rawBody?: Buffer;
} = {}): Request {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    headers[key.toLowerCase()] = value;
  }
  const req = {
    method: init.method ?? "POST",
    headers,
    body: init.body,
    params: init.params ?? {},
    originalUrl: init.originalUrl ?? "/",
    path: init.path ?? "/",
    rawBody: init.rawBody,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  };
  return req as unknown as Request;
}

export interface MockResponse {
  res: Response;
  statusCode: () => number;
  body: () => unknown;
  headers: Record<string, string>;
  finish: () => void;
}

/** Minimal Express response stand-in that records status, body, and headers. */
export function mockRes(): MockResponse {
  let statusCode = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  const finishListeners: Array<() => void> = [];
  const res = {
    headersSent: false,
    get statusCode() {
      return statusCode;
    },
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      body = payload;
      return res;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
      return res;
    }),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === "finish") finishListeners.push(listener);
      return res;
    }),
  };
  return {
    res: res as unknown as Response,
    statusCode: () => statusCode,
    body: () => body,
    headers,
    finish: () => finishListeners.forEach((listener) => listener()),
  };
}

export function mockNext(): NextFunction & ReturnType<typeof vi.fn> {
  return vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
}

/** Restores the given env vars to their values at call time. */
export function snapshotEnv(...names: string[]): () => void {
  const saved = names.map((name) => [name, process.env[name]] as const);
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
