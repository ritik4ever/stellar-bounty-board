import { logStructured } from "../logger";

export const MAX_ROTATION_GRACE_MS = 300_000;

/**
 * Validates environment variables used when an old and new webhook secret overlap
 * during a secret rotation transition. Fails fast before any request signing or
 * token transfer occurs.
 */
export function validateWebhookSecretRotationEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  const activeSecret = env.GITHUB_WEBHOOK_SECRET ?? env.WEBHOOK_ROTATION_NEW_SECRET;
  const previousSecret = env.GITHUB_WEBHOOK_SECRET_PREVIOUS ?? env.WEBHOOK_ROTATION_OLD_SECRET;
  const graceRaw = env.GITHUB_WEBHOOK_ROTATION_GRACE_MS;
  const startedAtRaw = env.GITHUB_WEBHOOK_ROTATION_STARTED_AT;

  const hasOverlapConfig =
    previousSecret !== undefined || graceRaw !== undefined || startedAtRaw !== undefined;

  if (!hasOverlapConfig) {
    return;
  }

  if (!activeSecret || activeSecret.trim() === "") {
    throw new Error(
      "Invalid webhook rotation setup: active secret (GITHUB_WEBHOOK_SECRET or WEBHOOK_ROTATION_NEW_SECRET) is required when rotation overlap is configured.",
    );
  }

  if (previousSecret !== undefined) {
    if (previousSecret.trim() === "") {
      throw new Error(
        "Invalid webhook rotation setup: previous secret (GITHUB_WEBHOOK_SECRET_PREVIOUS or WEBHOOK_ROTATION_OLD_SECRET) cannot be empty.",
      );
    }
    if (previousSecret === activeSecret) {
      throw new Error(
        "Invalid webhook rotation setup: previous secret and active secret must be distinct.",
      );
    }
    if (startedAtRaw === undefined || startedAtRaw.trim() === "") {
      throw new Error(
        "Invalid webhook rotation setup: GITHUB_WEBHOOK_ROTATION_STARTED_AT is required when previous secret is configured.",
      );
    }
  }

  if (startedAtRaw !== undefined) {
    const startedAt = Number(startedAtRaw);
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
      throw new Error(
        `Invalid webhook rotation setup: GITHUB_WEBHOOK_ROTATION_STARTED_AT ("${startedAtRaw}") must be a non-negative integer timestamp.`,
      );
    }
  }

  if (graceRaw !== undefined) {
    const graceMs = Number(graceRaw);
    if (!Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > MAX_ROTATION_GRACE_MS) {
      throw new Error(
        `Invalid webhook rotation setup: GITHUB_WEBHOOK_ROTATION_GRACE_MS ("${graceRaw}") must be an integer between 1 and ${MAX_ROTATION_GRACE_MS} ms.`,
      );
    }
  }
}

/**
 * Validates that GITHUB_WEBHOOK_SECRET is configured on application startup.
 *
 * In production, a missing secret is a critical security issue and the app will not start.
 * In development, a warning is logged but the app continues (for local testing without webhooks).
 *
 * A secret made only of whitespace counts as missing. `NODE_ENV` defaults to
 * `development` when unset, so only `NODE_ENV=production` fails. It does not
 * check the secret's strength or length.
 *
 * Reads the environment on every call and has no other state, so it is safe
 * to call more than once. Call it before the server starts accepting requests.
 *
 * @returns Nothing. Outside production a missing secret logs a
 *   `startup_validation_warning` and returns normally.
 * @throws {Error} In production if GITHUB_WEBHOOK_SECRET is missing or empty.
 *   A `startup_validation_failed` error line is logged first.
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

  validateWebhookSecretRotationEnv(process.env);
}
