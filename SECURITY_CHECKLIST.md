# Security Review Checklist

This checklist is based on OWASP Top 10 inspired principles. When making a pull request, review the following items and ensure relevant files have been verified.

## 1. Input Validation Changed
Check for proper validation, sanitization, and typing of all inputs from users or external systems.
**Relevant Files:** Route handlers, controllers, data transfer objects (DTOs), API layer.

## 2. Auth Modified
Check that authentication and authorization logic correctly verifies user identity and permissions without bypassing checks.
**Relevant Files:** Middleware, authentication services, token handlers.

## 3. New External Fetch
Check that any new external API calls or webhook requests are made securely (HTTPS), handle timeouts appropriately, and do not leak sensitive information in URLs.
**Relevant Files:** Services, integrations, API clients.

## 4. Dependency Added
Check that new dependencies are necessary, reputable, and free from known vulnerabilities (e.g., via `npm audit`).
**Relevant Files:** `package.json`, `package-lock.json`.

## 5. Secret Handling
Check that no credentials, tokens, or private keys are hardcoded in the source code and that environment variables are securely handled.
**Relevant Files:** Configuration files, environment loaders, CI/CD workflows.
