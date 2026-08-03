declare module 'pino-http' {
  import type { Logger } from 'pino';
  import type { IncomingMessage, ServerResponse } from 'http';

  type ReqId = number | string | object;

  interface GenReqId<IM = IncomingMessage, SR = ServerResponse> {
    (req: IM, res: SR): ReqId;
  }

  interface AutoLoggingOptions<IM = IncomingMessage> {
    ignore?: ((req: IM) => boolean);
  }

  interface Options<IM = IncomingMessage, SR = ServerResponse> {
    logger?: Logger;
    genReqId?: GenReqId<IM, SR>;
    autoLogging?: boolean | AutoLoggingOptions<IM>;
    useLevel?: string;
    customLogLevel?: ((req: IM, res: SR, error?: Error) => string);
  }

  interface HttpLogger<IM = IncomingMessage, SR = ServerResponse> {
    (req: IM, res: SR, next?: () => void): void;
    logger: Logger;
  }

  function PinoHttp<IM = IncomingMessage, SR = ServerResponse>(opts?: Options<IM, SR>): HttpLogger<IM, SR>;
  function PinoHttp<IM = IncomingMessage, SR = ServerResponse>(stream?: unknown): HttpLogger<IM, SR>;

  export default PinoHttp;
  export { PinoHttp as pinoHttp };

  declare module 'http' {
    interface IncomingMessage {
      id: ReqId;
      log: Logger;
    }
  }
}

declare module 'proper-lockfile' {
  interface LockOptions {
    stale?: number;
    update?: number;
    retries?: number;
  }
  function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
  function unlock(file: string): Promise<void>;
  function check(file: string): Promise<boolean>;
  export { lock, unlock, check };
}

declare module 'ioredis' {
  import { EventEmitter } from 'events';
  class Redis extends EventEmitter {
    constructor(options?: unknown);
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: unknown[]): Promise<string>;
    del(...keys: string[]): Promise<number>;
    quit(): Promise<void>;
  }
  export default Redis;
}

declare module 'prom-client' {
  export class Counter<T extends string = string> {
    constructor(opts: { name: string; help: string; registers?: Registry[] });
    inc(value?: number): void;
  }
  export class Histogram<T extends string = string> {
    constructor(opts: { name: string; help: string; labelNames?: readonly T[]; buckets?: number[]; registers?: Registry[] });
    observe(labels: Record<T, string>, value: number): void;
  }
  export class Registry {
    getSingleMetric(name: string): Counter | Histogram | undefined;
    metrics(): Promise<string>;
    static merge(registers: Registry[]): Registry;
  }
  export const register: Registry;
  export function collectDefaultMetrics(opts?: { register?: Registry }): void;
}