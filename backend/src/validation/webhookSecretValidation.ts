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
