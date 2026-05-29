/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export {};
