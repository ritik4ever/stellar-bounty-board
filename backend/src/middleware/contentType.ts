import type { NextFunction, Request, Response } from 'express';

/**
 * Rejects `POST` and `PATCH` requests whose `Content-Type` header does not
 * contain `application/json` with 415 `{ error: "Content-Type must be application/json" }`.
 *
 * Other methods pass through untouched. The check is a substring match, so
 * `application/json; charset=utf-8` is accepted. The comparison is
 * case-sensitive, and `PUT` and `DELETE` are not checked.
 *
 * Never throws. Stateless.
 *
 * @param req - Incoming request; only `method` and the `content-type` header are read.
 * @param res - Used to send the 415 response.
 * @param next - Called with no arguments when the request is allowed.
 */
export function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  // Only validate POST and PATCH requests
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    next();
    return;
  }

  const contentType = req.headers['content-type'];

  // Check if Content-Type header is missing or not application/json
  if (!contentType || !contentType.includes('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json' });
    return;
  }

  next();
}
