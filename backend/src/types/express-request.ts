declare global {
  namespace Express {
    interface Request {
      /** Correlation id for logs and error responses; set by request context middleware. */
      requestId: string;
    }
  }
}

export {};
