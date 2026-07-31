import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateGitHubWebhookSecret } from "../src/validation/webhookSecretValidation";
import {
  githubWebhookSignatureProfile,
  signWebhookPayload,
  verifyWithSecretRotation,
} from "../src/webhooks/signatureVerification";

vi.mock("../src/logger", () => ({
  logStructured: vi.fn(),
}));

describe("validateGitHubWebhookSecret", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
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

      // Note: The current implementation is case-sensitive.
      // This test documents that behavior. If case-insensitivity is desired,
      // the implementation should be updated.
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

// ---------------------------------------------------------------------------
// Secret Rotation Grace-Period Tests
// ---------------------------------------------------------------------------

/**
 * Helpers shared across rotation scenarios.
 *
 * `buildSignature` signs a fixed payload with the given secret so the tests
 * can exercise each branch of verifyWithSecretRotation without relying on
 * the full middleware stack.
 */

const OLD_SECRET = "old-webhook-secret-before-rotation";
const NEW_SECRET = "new-webhook-secret-after-rotation";
const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

function buildPayload(): Buffer {
  return Buffer.from(JSON.stringify({ action: "opened", number: 1 }), "utf8");
}

function buildSignature(payload: Buffer, secret: string): string {
  return signWebhookPayload({
    payload,
    secret,
    algorithm: githubWebhookSignatureProfile.algorithm,
    prefix: githubWebhookSignatureProfile.prefix,
  });
}

describe("verifyWithSecretRotation — grace-period window", () => {
  const payload = buildPayload();

  // -------------------------------------------------------------------------
  // 1. Request signed with old secret arrives DURING the grace period
  // -------------------------------------------------------------------------
  describe("during the grace period", () => {
    it("accepts a request signed with the previous secret while within the grace window", () => {
      // Rotation started 1 minute ago → still inside the 5-minute window.
      const rotationStartedAt = Date.now() - 60_000;
      const signatureHeader = buildSignature(payload, OLD_SECRET);

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: GRACE_PERIOD_MS,
          rotationStartedAt,
        }),
      ).not.toThrow();
    });

    it("accepts a request signed with the new secret during the grace period", () => {
      // Even while the old secret is still valid, the new secret must also work.
      const rotationStartedAt = Date.now() - 60_000;
      const signatureHeader = buildSignature(payload, NEW_SECRET);

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: GRACE_PERIOD_MS,
          rotationStartedAt,
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Request signed with old secret arrives AFTER the grace period expires
  // -------------------------------------------------------------------------
  describe("after the grace period expires", () => {
    it("rejects a request signed with the previous secret after the grace window closes", () => {
      // Rotation started 6 minutes ago → window has expired.
      const rotationStartedAt = Date.now() - 6 * 60_000;
      const signatureHeader = buildSignature(payload, OLD_SECRET);

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: GRACE_PERIOD_MS,
          rotationStartedAt,
        }),
      ).toThrow(/Invalid GitHub webhook signature/i);
    });

    it("still accepts a request signed with the new secret after the grace window closes", () => {
      const rotationStartedAt = Date.now() - 6 * 60_000;
      const signatureHeader = buildSignature(payload, NEW_SECRET);

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: GRACE_PERIOD_MS,
          rotationStartedAt,
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 3. In-flight request: simulates a request that was in flight when rotation
  //    began (signed just before the swap, processed just after)
  // -------------------------------------------------------------------------
  describe("in-flight request during rotation", () => {
    it("accepts a request signed moments before rotation, verified moments after", () => {
      // The request was signed with the old secret 30 seconds before rotation
      // started; it arrives 10 seconds into the grace window.
      const rotationStartedAt = Date.now() - 10_000; // 10 s ago
      const signatureHeader = buildSignature(payload, OLD_SECRET);

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: GRACE_PERIOD_MS,
          rotationStartedAt,
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Request signed with neither secret is always rejected
  // -------------------------------------------------------------------------
  describe("request signed with an unknown secret", () => {
    it("rejects a request that does not match either secret (during grace period)", () => {
      const rotationStartedAt = Date.now() - 60_000; // within window
      const signatureHeader = buildSignature(payload, "completely-wrong-secret");

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: GRACE_PERIOD_MS,
          rotationStartedAt,
        }),
      ).toThrow(/Invalid GitHub webhook signature/i);
    });

    it("rejects a request that does not match either secret (after grace period)", () => {
      const rotationStartedAt = Date.now() - 6 * 60_000; // window expired
      const signatureHeader = buildSignature(payload, "completely-wrong-secret");

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: GRACE_PERIOD_MS,
          rotationStartedAt,
        }),
      ).toThrow(/Invalid GitHub webhook signature/i);
    });

    it("rejects a request with no previousSecret configured that uses any other key", () => {
      // No rotation in progress — only newSecret should be accepted.
      const signatureHeader = buildSignature(payload, OLD_SECRET);

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          // previousSecret intentionally omitted
        }),
      ).toThrow(/Invalid GitHub webhook signature/i);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("rejects when the signature header is missing", () => {
      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader: undefined,
          newSecret: NEW_SECRET,
        }),
      ).toThrow(/Missing GitHub webhook signature/i);
    });

    it("rejects when the signature header has an invalid prefix", () => {
      const validSig = buildSignature(payload, NEW_SECRET);
      const wrongPrefix = validSig.replace("sha256=", "sha1=");

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader: wrongPrefix,
          newSecret: NEW_SECRET,
        }),
      ).toThrow(/Invalid GitHub webhook signature format/i);
    });

    it("accepts the new secret when no rotation is in progress (no previousSecret)", () => {
      const signatureHeader = buildSignature(payload, NEW_SECRET);

      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
        }),
      ).not.toThrow();
    });

    it("uses a custom grace period of 1 minute correctly", () => {
      const rotationStartedAt = Date.now() - 30_000; // 30 s ago
      const customGracePeriodMs = 60_000; // 1 minute
      const signatureHeader = buildSignature(payload, OLD_SECRET);

      // 30 s < 1 min → still within custom window
      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: customGracePeriodMs,
          rotationStartedAt,
        }),
      ).not.toThrow();

      // Now 90 s past start → outside the 1-minute window
      const expiredStartedAt = Date.now() - 90_000;
      expect(() =>
        verifyWithSecretRotation({
          ...githubWebhookSignatureProfile,
          payload,
          signatureHeader,
          newSecret: NEW_SECRET,
          previousSecret: OLD_SECRET,
          gracePeriodMs: customGracePeriodMs,
          rotationStartedAt: expiredStartedAt,
        }),
      ).toThrow(/Invalid GitHub webhook signature/i);
    });
  });
});
