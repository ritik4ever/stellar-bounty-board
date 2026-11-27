import type { Request } from 'express-serve-static-core';
import type pino from 'pino';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id for logs and error responses; set by request context middleware. */
    requestId: string;
    log: pino.Logger;
    /** The Stellar public key of the authenticated signer, set by createStellarSignatureAuthMiddleware. */
    signerPublicKey?: string;
  }
}

export type RequestWithId = Request & {
  requestId: string;
  log: pino.Logger;
  signerPublicKey?: string;
};
