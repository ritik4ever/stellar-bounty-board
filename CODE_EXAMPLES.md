# GitHub Webhook Secret Validation - Code Examples

## Complete Implementation Reference

This document provides complete code examples for the GitHub webhook secret validation implementation.

## 1. Validation Module

**File:** `backend/src/validation/webhookSecretValidation.ts`

```typescript
import { logStructured } from "../logger";

/**
 * Validates that GITHUB_WEBHOOK_SECRET is configured on application startup.
 *
 * In production, a missing secret is a critical security issue and the app will not start.
 * In development, a warning is logged but the app continues (for local testing without webhooks).
 *
 * @throws {Error} In production if GITHUB_WEBHOOK_SECRET is missing or empty
 */
export function validateGitHubWebhookSecret(): void {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  // Check if secret is missing or empty
  if (!secret || secret.trim() === "") {
    const errorMessage =
      "GITHUB_WEBHOOK_SECRET environment variable is not configured. " +
      "This is required to verify GitHub webhook signatures and prevent unauthorized webhook events. " +
      "Set GITHUB_WEBHOOK_SECRET to a secure random string (e.g., openssl rand -hex 20).";

    if (isProduction) {
      // In production, fail fast before any routes are initialized
      logStructured("error", "startup_validation_failed", {
        reason: "missing_github_webhook_secret",
        environment: nodeEnv,
      });
      throw new Error(errorMessage);
    } else {
      // In development, log a warning but allow startup
      logStructured("warn", "startup_validation_warning", {
        reason: "missing_github_webhook_secret",
        environment: nodeEnv,
        message: "GitHub webhooks will not be verified. This is only acceptable in development.",
      });
    }
  }
}
```

## 2. Startup Integration

**File:** `backend/src/index.ts`

```typescript
import "dotenv/config";
import { app } from "./app";
import { logStructured } from "./logger";
import { validateGitHubWebhookSecret } from "./validation/webhookSecretValidation";

// Validate critical environment variables before starting the server
validateGitHubWebhookSecret();

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  logStructured("info", "server_listen", { port });
});
```

## 3. Webhook Route (Existing)

**File:** `backend/src/app.ts`

```typescript
import {
  createGitHubWebhookSignatureMiddleware,
} from "./webhooks/signatureVerification";
import { handleGitHubPrEvent } from "./webhooks/githubPrHandler";

// ... other routes ...

app.post(
  "/api/webhooks/github",
  createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET),
  async (req: Request, res: Response) => {
    try {
      await handleGitHubPrEvent(req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook processing error";
      res.status(500).json({ error: message, requestId: req.requestId });
      return;
    }
    res.status(202).json({
      data: {
        authenticated: true,
        provider: "github",
        received: true,
      },
    });
  },
);
```

## 4. Signature Verification (Existing)

**File:** `backend/src/webhooks/signatureVerification.ts`

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";

export interface WebhookSignatureProfile {
  algorithm: "sha1" | "sha256" | "sha512";
  headerName: string;
  prefix: string;
  providerName: string;
}

export const githubWebhookSignatureProfile: WebhookSignatureProfile = {
  algorithm: "sha256",
  headerName: "x-hub-signature-256",
  prefix: "sha256=",
  providerName: "GitHub",
};

export function verifyWebhookSignature({
  payload,
  secret,
  signatureHeader,
  algorithm,
  headerName,
  prefix,
  providerName,
}: {
  payload: Buffer | string;
  secret: string | undefined;
  signatureHeader: string | string[] | undefined;
  algorithm: "sha1" | "sha256" | "sha512";
  headerName: string;
  prefix: string;
  providerName: string;
}): void {
  if (!secret) {
    throw new Error(`Missing ${providerName} webhook secret configuration.`);
  }

  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!signature) {
    throw new Error(`Missing ${providerName} webhook signature in ${headerName}.`);
  }

  if (!signature.startsWith(prefix)) {
    throw new Error(`Invalid ${providerName} webhook signature format.`);
  }

  // Compute expected signature
  const expectedSignature = `${prefix}${createHmac(algorithm, secret).update(payload).digest("hex")}`;

  // Timing-safe comparison
  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expectedSignature);
  
  if (providedBytes.length !== expectedBytes.length) {
    throw new Error(`Invalid ${providerName} webhook signature.`);
  }

  if (!timingSafeEqual(providedBytes, expectedBytes)) {
    throw new Error(`Invalid ${providerName} webhook signature.`);
  }
}

export function createGitHubWebhookSignatureMiddleware(
  secret: string | (() => string | undefined),
): RequestHandler {
  return (req, res, next) => {
    try {
      const resolvedSecret = typeof secret === "function" ? secret() : secret;
      
      verifyWebhookSignature({
        ...githubWebhookSignatureProfile,
        payload: (req as any).rawBody || JSON.stringify(req.body),
        secret: resolvedSecret,
        signatureHeader: req.header("x-hub-signature-256"),
      });
      
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signature verification failed";
      res.status(401).json({ error: message });
    }
  };
}
```

## 5. Comprehensive Tests

**File:** `backend/test/webhookSecretValidation.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateGitHubWebhookSecret } from "../src/validation/webhookSecretValidation";

describe("validateGitHubWebhookSecret", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.mock("../src/logger", () => ({
      logStructured: vi.fn(),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("Production environment", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("should throw error when GITHUB_WEBHOOK_SECRET is missing", () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;

      expect(() => {
        validateGitHubWebhookSecret();
      }).toThrow(/GITHUB_WEBHOOK_SECRET environment variable is not configured/);
    });

    it("should throw error when GITHUB_WEBHOOK_SECRET is empty string", () => {
      process.env.GITHUB_WEBHOOK_SECRET = "";

      expect(() => {
        validateGitHubWebhookSecret();
      }).toThrow(/GITHUB_WEBHOOK_SECRET environment variable is not configured/);
    });

    it("should throw error when GITHUB_WEBHOOK_SECRET is only whitespace", () => {
      process.env.GITHUB_WEBHOOK_SECRET = "   ";

      expect(() => {
        validateGitHubWebhookSecret();
      }).toThrow(/GITHUB_WEBHOOK_SECRET environment variable is not configured/);
    });

    it("should not throw when GITHUB_WEBHOOK_SECRET is set", () => {
      process.env.GITHUB_WEBHOOK_SECRET = "test-secret-key";

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });

    it("should include actionable guidance in error message", () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;

      try {
        validateGitHubWebhookSecret();
        expect.fail("Should have thrown an error");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("openssl rand -hex 20");
        expect(message).toContain("webhook signatures");
      }
    });
  });

  describe("Development environment", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("should not throw when GITHUB_WEBHOOK_SECRET is missing", () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });

    it("should not throw when GITHUB_WEBHOOK_SECRET is empty string", () => {
      process.env.GITHUB_WEBHOOK_SECRET = "";

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });

    it("should not throw when GITHUB_WEBHOOK_SECRET is only whitespace", () => {
      process.env.GITHUB_WEBHOOK_SECRET = "   ";

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });

    it("should not throw when GITHUB_WEBHOOK_SECRET is set", () => {
      process.env.GITHUB_WEBHOOK_SECRET = "test-secret-key";

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });
  });

  describe("Default environment (when NODE_ENV is not set)", () => {
    beforeEach(() => {
      delete process.env.NODE_ENV;
    });

    it("should treat missing NODE_ENV as development and not throw", () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });
  });

  describe("Edge cases", () => {
    it("should handle NODE_ENV with different casings", () => {
      process.env.NODE_ENV = "PRODUCTION";
      delete process.env.GITHUB_WEBHOOK_SECRET;

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });

    it("should accept secrets with special characters", () => {
      process.env.NODE_ENV = "production";
      process.env.GITHUB_WEBHOOK_SECRET = "!@#$%^&*()_+-=[]{}|;:,.<>?";

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });

    it("should accept very long secrets", () => {
      process.env.NODE_ENV = "production";
      process.env.GITHUB_WEBHOOK_SECRET = "a".repeat(1000);

      expect(() => {
        validateGitHubWebhookSecret();
      }).not.toThrow();
    });
  });
});
```

## 6. Environment Configuration

**File:** `.env.example`

```dotenv
# ==============================================================================
# ENVIRONMENT VARIABLES CONFIGURATION
# Copy this file to .env and update the values for your local setup.
# IMPORTANT: Never commit the actual .env file to git.
# ==============================================================================

# ------------------------------------------------------------------------------
# BACKEND CONFIGURATION
# ------------------------------------------------------------------------------

# [REQUIRED] The port the backend server will listen on.
PORT=3001

# [REQUIRED] Secret used to verify signatures for GitHub Webhooks.
# This is critical for security - it prevents attackers from sending fake webhook events.
# Generate a random string: openssl rand -hex 20
# In production, this MUST be set or the application will refuse to start.
# In development, a warning is logged if missing, but the app continues.
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret_here

# [REQUIRED] Local file path for the bounty data store JSON.
BOUNTY_STORE_PATH=./data/bounties.json

# [REQUIRED] Local file path for the audit logs data store JSON.
BOUNTY_AUDIT_STORE_PATH=./data/audit.json

# [OPTIONAL] Defines the environment (e.g., development, test, production).
# Default: development
NODE_ENV=development

# [OPTIONAL] CORS allowed origins (comma-separated). Default: http://localhost:5173
CORS_ORIGINS=http://localhost:5173

# [OPTIONAL] Logging level (debug, info, warn, error). Default: info
LOG_LEVEL=info

# ... rest of configuration ...
```

## 7. Usage Examples

### Example 1: Production Deployment

```bash
#!/bin/bash
# deploy.sh

# Generate secure secret
SECRET=$(openssl rand -hex 20)
echo "Generated secret: $SECRET"

# Set environment variables
export NODE_ENV=production
export GITHUB_WEBHOOK_SECRET=$SECRET
export PORT=3001

# Build application
npm run build

# Start application
npm start

# Expected output:
# [INFO] server_listen { port: 3001 }
```

### Example 2: Development Setup

```bash
#!/bin/bash
# dev-setup.sh

# Copy environment template
cp .env.example .env

# Set development environment
echo "NODE_ENV=development" >> .env

# Optional: Set test secret for webhook testing
echo "GITHUB_WEBHOOK_SECRET=test-secret-123" >> .env

# Install dependencies
npm install

# Start development server
npm run dev

# Expected output:
# [WARN] startup_validation_warning { reason: "missing_github_webhook_secret" }
# [INFO] server_listen { port: 3001 }
```

### Example 3: Testing Webhook Signature

```bash
#!/bin/bash
# test-webhook.sh

# Configuration
SECRET="test-secret-123"
PAYLOAD='{"action":"opened","pull_request":{"number":1}}'
URL="http://localhost:3001/api/webhooks/github"

# Compute signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

# Send request
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"

# Expected response:
# {"data":{"authenticated":true,"provider":"github","received":true}}
```

### Example 4: Docker Deployment

```dockerfile
# Dockerfile

FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY backend/src ./src

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3001

# Start application
CMD ["npm", "start"]
```

**Docker Compose:**

```yaml
# docker-compose.yml

version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      NODE_ENV: production
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET}
      PORT: 3001
    volumes:
      - ./backend/data:/app/data
    restart: unless-stopped
```

**Usage:**

```bash
# Set secret in environment
export GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 20)

# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f backend
```

## 8. Integration Tests

```typescript
// test/integration.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";

describe("GitHub Webhook Integration", () => {
  let app: any;
  const SECRET = "test-secret-123";

  beforeEach(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    process.env.NODE_ENV = "test";
    const { app: importedApp } = await import("../src/app");
    app = importedApp;
  });

  it("should accept webhook with valid signature", async () => {
    const payload = { action: "opened", pull_request: { number: 1 } };
    const payloadString = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", SECRET).update(payloadString).digest("hex")}`;

    const res = await request(app)
      .post("/api/webhooks/github")
      .set("x-hub-signature-256", signature)
      .send(payload);

    expect(res.status).toBe(202);
    expect(res.body.data.authenticated).toBe(true);
  });

  it("should reject webhook with invalid signature", async () => {
    const payload = { action: "opened", pull_request: { number: 1 } };

    const res = await request(app)
      .post("/api/webhooks/github")
      .set("x-hub-signature-256", "sha256=invalid")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid");
  });

  it("should reject webhook without signature", async () => {
    const payload = { action: "opened", pull_request: { number: 1 } };

    const res = await request(app)
      .post("/api/webhooks/github")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Missing");
  });
});
```

## 9. Error Handling Examples

```typescript
// Example: Custom error handler

import { validateGitHubWebhookSecret } from "./validation/webhookSecretValidation";

try {
  validateGitHubWebhookSecret();
} catch (error) {
  if (error instanceof Error) {
    console.error("Startup validation failed:", error.message);
    process.exit(1);
  }
}

// Example: Graceful degradation in development

if (process.env.NODE_ENV === "development") {
  try {
    validateGitHubWebhookSecret();
  } catch (error) {
    console.warn("Webhook verification disabled in development");
    // Continue with development server
  }
}
```

## 10. Monitoring and Logging

```typescript
// Example: Custom logging for webhook events

import { logStructured } from "./logger";

// Successful webhook
logStructured("info", "github_webhook_processed", {
  bountyId: "BNT-0001",
  prUrl: "https://github.com/owner/repo/pull/100",
  action: "merged",
  durationMs: 150,
});

// Failed signature verification
logStructured("warn", "webhook_signature_verification_failed", {
  reason: "Invalid GitHub webhook signature",
  statusCode: 401,
  headerName: "x-hub-signature-256",
});

// Startup validation
logStructured("error", "startup_validation_failed", {
  reason: "missing_github_webhook_secret",
  environment: "production",
  timestamp: new Date().toISOString(),
});
```

## Summary

This implementation provides:
- ✅ Secure startup validation
- ✅ Environment-aware behavior (production vs development)
- ✅ Clear error messages with actionable guidance
- ✅ Comprehensive test coverage (13 tests)
- ✅ Integration with existing webhook verification
- ✅ Structured logging for monitoring
- ✅ Production-ready deployment examples
