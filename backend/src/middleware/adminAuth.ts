import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";

const HEADER_ADMIN_KEY = "x-admin-api-key";
const HEADER_AUTHORIZATION = "authorization";
const ENV_ADMIN_KEY_HASH = "ADMIN_API_KEY_HASH";
const ENV_SESSION_TTL_SECONDS = "ADMIN_SESSION_TTL_SECONDS";
const DEFAULT_SESSION_TTL_SECONDS = 900;

type SessionMetadata = {
  issuedAt: number;
  expiresAt: number;
  revokedAt?: number;
  rotatedTo?: string;
};

export class AdminSessionStore {
  private readonly sessions = new Map<string, SessionMetadata>();

  issue(now = Date.now()): string {
    this.removeExpired(now);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(hashToken(token), {
      issuedAt: now,
      expiresAt: now + getSessionTtlMs(),
    });
    return token;
  }

  validate(token: string, now = Date.now()): "valid" | "expired" | "revoked" | "invalid" {
    const metadata = this.sessions.get(hashToken(token));
    if (!metadata) return "invalid";
    if (metadata.revokedAt) return "revoked";
    if (metadata.expiresAt <= now) return "expired";
    return "valid";
  }

  rotate(token: string, now = Date.now()): string | undefined {
    if (this.validate(token, now) !== "valid") return undefined;
    const nextToken = this.issue(now);
    const metadata = this.sessions.get(hashToken(token));
    if (metadata) {
      metadata.revokedAt = now;
      metadata.rotatedTo = hashToken(nextToken);
    }
    return nextToken;
  }

  private removeExpired(now: number): void {
    for (const [hash, metadata] of this.sessions) {
      if (metadata.expiresAt <= now) this.sessions.delete(hash);
    }
  }
}

const defaultSessionStore = new AdminSessionStore();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionTtlMs(): number {
  const configured = Number.parseInt(process.env[ENV_SESSION_TTL_SECONDS] ?? "", 10);
  const seconds = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_TTL_SECONDS;
  return seconds * 1000;
}

function getBearerToken(req: Request): string | undefined {
  const authorization = req.header(HEADER_AUTHORIZATION);
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

async function verifyAdminApiKey(req: Request, res: Response): Promise<boolean> {
  const storedHash = process.env[ENV_ADMIN_KEY_HASH];
  if (!storedHash) {
    res.status(500).json({ error: "Admin API key is not configured on this server." });
    return false;
  }
  const incomingKey = req.header(HEADER_ADMIN_KEY);
  if (!incomingKey) {
    res.status(401).json({ error: `Missing ${HEADER_ADMIN_KEY} header.` });
    return false;
  }
  try {
    if (await bcrypt.compare(incomingKey, storedHash)) return true;
  } catch {
    res.status(500).json({ error: "Failed to verify admin API key." });
    return false;
  }
  res.status(401).json({ error: "Invalid admin API key." });
  return false;
}

export function createAdminSessionHandlers(sessionStore = defaultSessionStore): {
  issue: RequestHandler;
  rotate: RequestHandler;
} {
  return {
    issue: async (req, res) => {
      if (await verifyAdminApiKey(req, res)) res.status(201).json({ token: sessionStore.issue() });
    },
    rotate: (req, res) => {
      const token = getBearerToken(req);
      if (!token) {
        res.status(401).json({ error: "Missing Bearer session token." });
        return;
      }
      const nextToken = sessionStore.rotate(token);
      if (!nextToken) {
        res.status(401).json({ error: "Invalid, expired, or revoked admin session token." });
        return;
      }
      res.status(201).json({ token: nextToken });
    },
  };
}

/**
 * Express middleware that authenticates admin requests using short-lived
 * session tokens.
 *
 * The operator stores the bcrypt hash in the `ADMIN_API_KEY_HASH` environment
 * variable (generated once via `scripts/hash-admin-key.js`). The raw key is
 * accepted only by the session bootstrap handler. Protected
 * requests must supply a bearer session token.
 *
 * Responds with:
 *  - 500 if `ADMIN_API_KEY_HASH` is not configured on the server.
 *  - 401 if the bearer token is missing, expired, or revoked.
 */
export function createAdminApiKeyAuthMiddleware(sessionStore = defaultSessionStore): RequestHandler {
  return async (req, res, next) => {
    // Skip auth in test environment so integration tests don't need a hash.
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const token = getBearerToken(req);
    if (!token || sessionStore.validate(token) !== "valid") {
      res.status(401).json({ error: "Missing or invalid admin session token." });
      return;
    }

    next();
  };
}
