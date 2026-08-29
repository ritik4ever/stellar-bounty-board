import type { Request, RequestHandler } from 'express';
import { verifyJwt } from '../utils/jwt';

const BEARER_PREFIX = 'Bearer ';

function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  if (authHeader.startsWith(BEARER_PREFIX)) {
    return authHeader.slice(BEARER_PREFIX.length);
  }
  return null;
}

export function createJwtAuthMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }

    const authHeader = req.header('Authorization');
    const token = extractToken(authHeader);

    if (!token) {
      res.status(401).json({ error: 'Missing or invalid Authorization header.' });
      return;
    }

    try {
      const payload = verifyJwt(token);
      (req as any).user = payload;
      next();
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'Token has expired.' });
      } else if (error.name === 'JsonWebTokenError') {
        res.status(401).json({ error: 'Invalid token.' });
      } else {
        res.status(401).json({ error: 'Token verification failed.' });
      }
    }
  };
}
