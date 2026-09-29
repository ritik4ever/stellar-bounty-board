import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger";
import { runWithCorrelationId } from "../correlation";

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
 *
 * An incoming `X-Request-ID` is used only if, after trimming, it is 1–128
 * characters of `[a-zA-Z0-9-]`. Anything else is replaced with a new UUID v4.
 * Sets `req.requestId` and `req.log` (a pino child logger bound to
 * `requestId`/`correlationId`) before calling `next()`, so later middleware and
 * routes can rely on both.
 *
 * The rest of the request runs inside a correlation context (#1457), so async
 * work started while handling the request (queued jobs, worker messages) can
 * recover the same id with `getCorrelationId()` and log it alongside the
 * request's own lines.
 *
 * Never throws. Stateless apart from the per-request `finish` listener.
 *
 * @param req - Incoming request; `requestId` and `log` are attached to it.
 * @param res - Response; the `X-Request-ID` header and a `finish` listener are added.
 * @param next - Always called, synchronously, with no arguments.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  req.log = logger.child({ requestId, correlationId: requestId });
  res.setHeader("X-Request-ID", requestId);

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs) / 1e6;
    req.log.info({
      correlationId: requestId,
      method: req.method,
      path: req.path || "/",
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
    }, "http_request");
  });

  // Run the rest of the request inside the correlation context so async work it
  // triggers inherits the id (#1457).
  runWithCorrelationId(requestId, next);
}
