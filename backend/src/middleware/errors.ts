import type { ErrorRequestHandler } from "express";
import { logger } from "../logger";

/** External dependencies a middleware can fail on. */
export type MiddlewareDependency = "json-store" | "file-lock" | "bcrypt";

export interface MiddlewareDependencyErrorOptions {
  /** Dotted name of the operation that was attempted, e.g. `maintainer_rate_limit.read_store`. */
  operation: string;
  /** The external dependency that failed. */
  dependency: MiddlewareDependency;
  /** HTTP status the client receives. */
  statusCode: number;
  /** Client-safe message. Must not contain driver, filesystem, or stack detail. */
  publicMessage: string;
  /** The original error thrown by the dependency. Logged, never sent to the client. */
  cause: unknown;
}

/**
 * Typed wrapper for a failure of an external dependency (JSON store, file
 * lock, bcrypt) inside a middleware.
 *
 * `message` and `publicMessage` are deliberately free of the cause's detail:
 * the original error is kept on `cause` for logging only, so rendering this
 * error can never leak a filesystem path or driver message to a client.
 */
export class MiddlewareDependencyError extends Error {
  readonly operation: string;
  readonly dependency: MiddlewareDependency;
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly cause: unknown;

  constructor(options: MiddlewareDependencyErrorOptions) {
    super(`${options.operation} failed (${options.dependency})`);
    this.name = "MiddlewareDependencyError";
    this.operation = options.operation;
    this.dependency = options.dependency;
    this.statusCode = options.statusCode;
    this.publicMessage = options.publicMessage;
    this.cause = options.cause;
  }
}

/** Response body for errors that did not come from a known, client-safe source. */
export const INTERNAL_ERROR_MESSAGE = "Internal server error.";

interface HttpErrorLike {
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
  message?: unknown;
}

/**
 * Returns the status and message of an `http-errors` style error (as thrown by
 * body-parser) when it is explicitly marked `expose: true` with a 4xx status.
 * Those messages are written for clients; anything else is treated as internal.
 */
function exposedClientError(err: unknown): { status: number; message: string } | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const candidate = err as HttpErrorLike;
  const status = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;
  if (
    candidate.expose === true &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    typeof candidate.message === "string"
  ) {
    return { status, message: candidate.message };
  }
  return undefined;
}

/**
 * Terminal Express error handler. Mount it after every route and every other
 * error handler.
 *
 * - {@link MiddlewareDependencyError}: logs `operation`, `dependency` and the
 *   original `cause`, then responds with its `statusCode` and `publicMessage`.
 * - `http-errors` style 4xx errors with `expose: true`: responds with their
 *   own status and message.
 * - Anything else: logs the error and responds `500 Internal server error.`
 *   so no raw dependency error or stack trace reaches a response body.
 *
 * Every JSON response includes `requestId` when request context is available.
 * If headers were already sent, the error is delegated to Express so it can
 * close the connection.
 */
import { ServiceDependencyError } from "../services/errors";

export function createTerminalErrorHandler(): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const log = req.log ?? logger;
    const requestId = req.requestId;

    if (err instanceof MiddlewareDependencyError) {
      log.error(
        {
          err: err.cause,
          operation: err.operation,
          dependency: err.dependency,
          statusCode: err.statusCode,
          requestId,
        },
        "middleware_dependency_failure",
      );
      res.status(err.statusCode).json({ error: err.publicMessage, requestId });
      return;
    }

    if (err instanceof ServiceDependencyError) {
      log.error(
        {
          err: err.cause,
          operation: err.operation,
          dependency: err.dependency,
          statusCode: err.statusCode,
          requestId,
        },
        "service_dependency_failure",
      );
      res.status(err.statusCode).json({ error: err.publicMessage, requestId });
      return;
    }

    const clientError = exposedClientError(err);
    if (clientError) {
      res.status(clientError.status).json({ error: clientError.message, requestId });
      return;
    }

    log.error({ err, requestId }, "unhandled_request_error");
    res.status(500).json({ error: INTERNAL_ERROR_MESSAGE, requestId });
  };
}
