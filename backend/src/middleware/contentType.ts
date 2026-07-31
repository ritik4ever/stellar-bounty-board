import type { NextFunction, Request, Response } from 'express';

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
