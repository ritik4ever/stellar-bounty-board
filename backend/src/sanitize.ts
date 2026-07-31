/**
 * sanitize.ts
 *
 * Lightweight HTML-encoding sanitizer for user-supplied text fields.
 *
 * Strategy
 * --------
 * 1. Trim leading/trailing whitespace.
 * 2. Encode the five characters that browsers interpret as HTML
 *    (&, <, >, ", ') so that any injected markup is stored as inert
 *    entity references rather than executable tags.
 *
 * This is the server-side defense-in-depth layer.
 * The PRIMARY XSS defense is React JSX on the frontend: React escapes all
 * string values rendered via JSX expressions (e.g. <p>{bounty.title}</p>)
 * before they reach the DOM, so stored markup never executes in the UI.
 * This backend layer protects any non-React consumers of the API
 * (curl, third-party clients, email digests, etc.).
 *
 * No external dependency is required — the five-character map covers every
 * HTML injection vector for plain text fields.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

const HTML_CHARS_RE = /[&<>"']/g;

/**
 * Trim whitespace then HTML-encode `&`, `<`, `>`, `"`, and `'`.
 *
 * @example
 * sanitizeText('  <script>alert(1)</script>  ')
 * // → '&lt;script&gt;alert(1)&lt;/script&gt;'
 *
 * sanitizeText('  Hello World  ')
 * // → 'Hello World'
 */
export function sanitizeText(value: string): string {
  return value.trim().replace(HTML_CHARS_RE, (ch) => HTML_ESCAPE_MAP[ch]);
}