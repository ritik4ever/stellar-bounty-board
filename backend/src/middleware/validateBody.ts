import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Builds a middleware that validates `req.body` against a Zod schema.
 *
 * On success, `req.body` is **replaced** by the parsed output: unknown keys
 * are stripped (for non-passthrough object schemas), and defaults and
 * transforms are applied. It then calls `next()`. On failure it responds 400
 * `{ error: "Validation failed", details: ZodIssue[] }` and does not call
 * `next()`.
 *
 * Uses `safeParse`, so a validation failure never throws. An exception thrown
 * inside a custom refinement or transform propagates synchronously and Express
 * forwards it to the error handler. Only synchronous schemas are supported;
 * a schema with async refinements throws.
 *
 * Must run after `express.json()`. Stateless.
 *
 * @param schema - Zod schema describing the expected body.
 * @returns A synchronous Express middleware.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues });
      return;
    }

    req.body = result.data;
    next();
  };
}
