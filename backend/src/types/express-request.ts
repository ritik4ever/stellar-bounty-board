import type { Request } from 'express-serve-static-core';
import type pino from 'pino';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id for logs and error responses; set by request context middleware. */
    requestId: string;
    log: pino.Logger;
  }
}

export type RequestWithId = Request & {
  requestId: string;
  log: pino.Logger;
};
