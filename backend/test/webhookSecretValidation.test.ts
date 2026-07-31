import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateGitHubWebhookSecret } from "../src/validation/webhookSecretValidation";

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
