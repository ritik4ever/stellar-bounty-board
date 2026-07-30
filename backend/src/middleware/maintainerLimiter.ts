import { Request, Response, NextFunction, RequestHandler } from "express";
import fs from "fs";
import path from "path";
import lockfile from "proper-lockfile";

const LIMIT = Number(process.env.MAINTAINER_BOUNTY_RATE_LIMIT ?? 10);
const WINDOW_MS = Number(process.env.MAINTAINER_BOUNTY_RATE_WINDOW_MS ?? 3600_000);

interface RateLimitRecord {
  timestamps: number[];
}

function getStorePath(): string {
  if (process.env.MAINTAINER_RATE_LIMIT_STORE_PATH?.trim()) {
    return path.resolve(process.env.MAINTAINER_RATE_LIMIT_STORE_PATH.trim());
  }
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(path.dirname(process.env.BOUNTY_STORE_PATH.trim()), "maintainer_rate_limits.json");
  }
  return path.resolve(process.cwd(), "data", "maintainer_rate_limits.json");
}

function ensureStore(storePath: string) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({}));
  }
}

export const maintainerLimiter: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (process.env.NODE_ENV === "test") {
    next();
    return;
  }
  
  const maintainer = req.body?.maintainer;
  if (!maintainer || typeof maintainer !== "string") {
    next();
    return;
  }

  const storePath = getStorePath();
  ensureStore(storePath);

  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(storePath, {
      retries: { retries: 5, minTimeout: 10, maxTimeout: 50 },
      stale: 5000,
    });
  } catch (err) {
    res.status(503).json({ error: "Service busy, please try again." });
    return;
  }

  try {
    const raw = fs.readFileSync(storePath, "utf8");
    let store: Record<string, RateLimitRecord> = {};
    try {
      store = JSON.parse(raw);
    } catch {
      // Ignore parse error and start fresh
    }

    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    const record = store[maintainer] || { timestamps: [] };
    
    // Clean up old timestamps
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= LIMIT) {
      const oldest = record.timestamps[0];
      const resetTime = oldest + WINDOW_MS;
      const retryAfter = Math.ceil((resetTime - now) / 1000);
      
      await release();

      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests. Please retry later." });
      return;
    }

    record.timestamps.push(now);
    store[maintainer] = record;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
    
    await release();
    next();
  } catch (err) {
    await release();
    next(err);
  }
};
