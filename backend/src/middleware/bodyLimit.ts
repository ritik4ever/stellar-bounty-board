import { Request, Response, NextFunction } from 'express';

function parseBytes(limit: string): number {
  const match = limit.match(/^(\d+)(kb|mb|b)?$/i);
  if (!match) throw new Error(`Invalid limit: ${limit}`);
  const value = parseInt(match[1], 10);
  const unit = (match[2] ?? 'b').toLowerCase();
  if (unit === 'mb') return value * 1024 * 1024;
  if (unit === 'kb') return value * 1024;
  return value;
}

/**
 * Rejects requests whose Content-Length exceeds the given limit before the
 * body is read. Use this on routes that should stay tightly bounded.
 */
export function enforceBodyLimit(limit: string) {
  const maxBytes = parseBytes(limit);
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > maxBytes) {
      res.status(413).json({ error: 'Payload Too Large' });
      return;
    }
    next();
  };
}

export const DEFAULT_BODY_LIMIT = '32kb';
export const LARGE_BODY_LIMIT = '256kb';
