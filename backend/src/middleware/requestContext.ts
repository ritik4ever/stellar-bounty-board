import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logStructured } from "../logger";

const INCOMING_REQUEST_ID = /^[a-zA-Z0-9-]{1,128}$/;

function resolveRequestId(req: Request): string {
  const raw = req.headers["x-request-id"];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (INCOMING_REQUEST_ID.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}

/**
 * Assigns a request id (honors X-Request-ID when valid), sets X-Request-ID on the response,
 * and logs one structured line per request on response finish (method, path, status, duration).
 * Does not log bodies or query strings (avoid accidental secret leakage).
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs) / 1e6;
    logStructured("info", "http_request", {
      requestId,
      method: req.method,
      path: req.path || "/",
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  });

  next();
}
